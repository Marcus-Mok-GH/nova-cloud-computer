import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BYOK gateway tests: routing (custom provider vs built-in), request shape,
// OpenAI-compatible stream parsing, and error mapping - all with a stubbed
// fetch so no real provider is contacted.

vi.mock("./db", () => ({
  getActiveCustomModelForUser: vi.fn(async () => null),
}));

const { builtinChat } = vi.hoisted(() => {
  const builtinResult = () => ({ text: "built-in", toolCalls: [], model: "mistral-large-latest", usage: null, allowance: { usedRequests: 1, maxRequests: 100, remainingRequests: 99, exhausted: false } });
  return { builtinChat: vi.fn(async () => builtinResult()) };
});
vi.mock("./mistralGateway", async importOriginal => {
  const actual = await importOriginal<typeof import("./mistralGateway")>();
  return { ...actual, chatWithMistralGateway: builtinChat, completeWithMistralGateway: vi.fn(async () => ({ text: "built-in", model: "mistral-large-latest", usage: null, allowance: { usedRequests: 1, maxRequests: 100, remainingRequests: 99, exhausted: false } })) };
});

vi.mock("./modelSecrets", () => ({
  decryptModelApiKey: vi.fn(() => "sk-byok-test-key"),
}));

// The upstream guard resolves provider hostnames; tests stub DNS so no real
// lookups happen and blocked ranges can be simulated per-test.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "104.18.7.4" }]),
}));

import { chatWithWorkspaceModel, completeWithWorkspaceModel, testCustomModelEndpoint, chatWithCustomModel } from "./byokGateway";
import { lookup as dnsLookup } from "node:dns/promises";
import { MistralGatewayClientError } from "./mistralGateway";
import { getActiveCustomModelForUser } from "./db";
import type { CustomModel } from "../drizzle/schema";

const ORIGINAL_FETCH = global.fetch;

function customModelFixture(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    id: 7,
    workspaceId: 3,
    name: "My OpenRouter key",
    modelId: "anthropic/claude-sonnet-4.5",
    baseUrl: "https://openrouter.ai/api/v1",
    compatibility: "openai",
    encryptedApiKey: "vault.cipher",
    supportsImageInput: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function sseResponse(chunks: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

beforeEach(() => {
  vi.mocked(getActiveCustomModelForUser).mockClear();
  vi.mocked(dnsLookup).mockClear();
  vi.mocked(dnsLookup).mockImplementation(async () => [{ address: "104.18.7.4" }]);
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.mocked(getActiveCustomModelForUser).mockReset();
  vi.mocked(getActiveCustomModelForUser).mockResolvedValue(null);
});

describe("BYOK routing", () => {
  it("routes chat to the custom provider when one is active", async () => {
    vi.mocked(getActiveCustomModelForUser).mockResolvedValue(customModelFixture());
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ]);
    });

    const chunks: string[] = [];
    const result = await chatWithWorkspaceModel(
      42,
      [{ role: "user", content: "Hi" }],
      { onChunk: chunk => chunks.push(chunk) }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe(
      "Bearer sk-byok-test-key"
    );
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: "anthropic/claude-sonnet-4.5",
      stream: true,
    });
    expect(result.text).toBe("Hello");
    expect(chunks).toEqual(["Hello"]);
    // BYOK never claims the shared built-in allowance.
    expect(result.allowance).toMatchObject({
      usedRequests: 0,
      maxRequests: null,
      exhausted: false,
    });
  });

  it("falls back to the built-in gateway when no custom model is active", async () => {
    vi.mocked(getActiveCustomModelForUser).mockResolvedValue(null);
    const result = await chatWithWorkspaceModel(42, [{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("built-in");
    expect(builtinChat).toHaveBeenCalledWith(42, [{ role: "user", content: "Hi" }], {});
    expect(global.fetch).toBe(ORIGINAL_FETCH);
  });

  it("routes single-prompt completions to the custom provider", async () => {
    vi.mocked(getActiveCustomModelForUser).mockResolvedValue(customModelFixture());
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ choices: [{ message: { content: "A title" } }], model: "anthropic/claude-sonnet-4.5" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await completeWithWorkspaceModel(42, "Summarize");
    expect(urls[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(result.text).toBe("A title");
  });

  it("appends /chat/completions only when the base URL does not already end with it", async () => {
    const model = customModelFixture({ baseUrl: "https://api.deepseek.com/v1/" });
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await chatWithCustomModel(model, [{ role: "user", content: "Hi" }]);
    expect(urls[0]).toBe("https://api.deepseek.com/v1/chat/completions");
  });
});

describe("BYOK chat behavior", () => {
  it("assembles streamed tool calls and text from OpenAI-style deltas", async () => {
    const model = customModelFixture();
    global.fetch = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ model: "anthropic/claude-sonnet-4.5", choices: [{ delta: { content: "Let me check." } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "create_file", arguments: "{\"name\":" } }] } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"a.md\"}" } }] }, finish_reason: "tool_calls" }] })}\n\n`,
        "data: [DONE]\n\n",
      ])
    );

    const chunks: string[] = [];
    const result = await chatWithCustomModel(model, [
      { role: "user", content: "Create a file" },
    ], { onChunk: chunk => chunks.push(chunk) });
    expect(chunks).toEqual(["Let me check."]);

    expect(result.text).toBe("Let me check.");
    expect(result.toolCalls).toEqual([
      { id: "call-1", name: "create_file", arguments: '{"name":"a.md"}' },
    ]);
    expect(result.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("sends tools to the provider and reads buffered tool calls", async () => {
    const model = customModelFixture();
    const bodies: string[] = [];
    global.fetch = vi.fn(async (_url: any, init: any) => {
      bodies.push(String(init.body));
      return new Response(
        JSON.stringify({
          model: model.modelId,
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  { id: "call-9", type: "function", function: { name: "run_bash", arguments: '{"command":"ls"}' } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const result = await chatWithCustomModel(model, [{ role: "user", content: "ls" }], {
      tools: [
        {
          type: "function",
          function: { name: "run_bash", description: "Run a command", parameters: { type: "object", properties: {} } },
        },
      ],
    });

    expect(JSON.parse(bodies[0])).toMatchObject({ tools: [{ function: { name: "run_bash" } }], tool_choice: "auto" });
    expect(result.toolCalls).toEqual([
      { id: "call-9", name: "run_bash", arguments: '{"command":"ls"}' },
    ]);
  });

  it("maps provider HTTP errors to configuration/client errors with the upstream message", async () => {
    const model = customModelFixture();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Invalid API key provided." } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(
      chatWithCustomModel(model, [{ role: "user", content: "Hi" }])
    ).rejects.toMatchObject({
      kind: "configuration",
      message: "Invalid API key provided.",
    });
  });

  it("reports a clear error when the saved key cannot be decrypted", async () => {
    const { decryptModelApiKey } = await import("./modelSecrets");
    vi.mocked(decryptModelApiKey).mockImplementationOnce(() => {
      throw new Error("bad");
    });
    const model = customModelFixture();
    global.fetch = vi.fn();
    await expect(
      chatWithCustomModel(model, [{ role: "user", content: "Hi" }])
    ).rejects.toBeInstanceOf(MistralGatewayClientError);
  });
});

describe("BYOK upstream guard", () => {
  it("rejects plain http outside localhost before any request is made", async () => {
    const model = customModelFixture({ baseUrl: "http://openrouter.example/v1" });
    global.fetch = vi.fn();
    await expect(chatWithCustomModel(model, [{ role: "user", content: "Hi" }])).rejects.toMatchObject({
      kind: "configuration",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("allows http for localhost model servers", async () => {
    const model = customModelFixture({ baseUrl: "http://localhost:11434/v1" });
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await chatWithCustomModel(model, [{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("ok");
    expect(urls[0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("blocks cloud metadata and link-local endpoints", async () => {
    vi.mocked(dnsLookup).mockImplementation(async () => [{ address: "169.254.169.254" }]);
    const model = customModelFixture({ baseUrl: "https://metadata-hop.example/v1" });
    global.fetch = vi.fn();
    await expect(chatWithCustomModel(model, [{ role: "user", content: "Hi" }])).rejects.toMatchObject({
      kind: "configuration",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("classifies provider network failures as unavailable, not stopped", async () => {
    const model = customModelFixture();
    global.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(chatWithCustomModel(model, [{ role: "user", content: "Hi" }])).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("blocks 0.0.0.0 endpoints, which can address local services", async () => {
    const model = customModelFixture({ baseUrl: "http://0.0.0.0:11434/v1" });
    global.fetch = vi.fn();
    await expect(chatWithCustomModel(model, [{ role: "user", content: "Hi" }])).rejects.toMatchObject({
      kind: "configuration",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks hostnames that resolve into private networks", async () => {
    vi.mocked(dnsLookup).mockImplementation(async () => [{ address: "10.0.0.5" }]);
    const model = customModelFixture({ baseUrl: "https://internal-service.example/v1" });
    global.fetch = vi.fn();
    await expect(chatWithCustomModel(model, [{ role: "user", content: "Hi" }])).rejects.toMatchObject({
      kind: "configuration",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("follows redirects but rejects a redirect to a private host", async () => {
    vi.mocked(dnsLookup).mockImplementation(async (hostname: any) => {
      if (String(hostname).startsWith("internal-redirect.")) return [{ address: "192.168.1.20" }];
      return [{ address: "104.18.7.4" }];
    });
    const model = customModelFixture({ baseUrl: "https://redirect-source.example/v1" });
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      if (calls.length === 1) return Response.redirect("https://internal-redirect.example/v1/chat/completions", 302);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await expect(chatWithCustomModel(model, [{ role: "user", content: "Hi" }])).rejects.toMatchObject({
      kind: "configuration",
    });
    expect(calls).toEqual(["https://redirect-source.example/v1/chat/completions"]);
  });

  it("follows redirects to public hosts and completes the chat", async () => {
    const model = customModelFixture({ baseUrl: "https://redirect-public.example/v1" });
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      if (calls.length === 1) return Response.redirect("https://redirect-target.example/v1/chat/completions", 307);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await chatWithCustomModel(model, [{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("ok");
    expect(calls[1]).toBe("https://redirect-target.example/v1/chat/completions");
  });

  it("still reports an aborted /stop as stopped", async () => {
    const model = customModelFixture();
    global.fetch = vi.fn((_url: any, init: any) => new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(new Error("The operation was aborted."));
      else init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted.")));
    }));
    const controller = new AbortController();
    controller.abort();
    await expect(
      chatWithCustomModel(model, [{ role: "user", content: "Hi" }], { signal: controller.signal })
    ).rejects.toMatchObject({ kind: "stopped" });
  });
});

describe("BYOK endpoint test", () => {
  it("requires a model ID instead of guessing a provider model", async () => {
    await expect(
      testCustomModelEndpoint({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_test", modelId: "   " })
    ).rejects.toMatchObject({ kind: "configuration" });
  });

  it("accepts a reachable endpoint and reports provider errors on failure", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await testCustomModelEndpoint({
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "gsk_test",
      modelId: "llama-3.1-8b-instant",
    });
    expect(result.ok).toBe(true);

    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Model not found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(
      testCustomModelEndpoint({
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: "gsk_test",
        modelId: "nope",
      })
    ).rejects.toMatchObject({ kind: "client_error", message: "Model not found" });
  });
});
