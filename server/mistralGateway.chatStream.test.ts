import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise the raw gateway stream handling in chatWithMistralGateway
// with a stubbed global fetch - the paths that turn a long tool-calling reply
// into "Mistral returned an invalid response" or a hung webhook.

vi.mock("./db", () => ({
  getActiveCustomModelForUser: vi.fn(async () => null),
  getMistralInferenceAllowanceForUser: vi.fn(async () => ({ usedRequests: 0 })),
  claimMistralInferenceRequestForUser: vi.fn(async () => ({ usedRequests: 1 })),
}));

import { chatWithMistralGateway, reasoningParamsForModel, resetMistralGatewayHealthCache } from "./mistralGateway";

const ORIGINAL_FETCH = global.fetch;

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

function modelsResponse() {
  return new Response(
    JSON.stringify({ data: [{ id: "mistral/test-model" }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

beforeEach(() => {
  // Tokens shorter than 32 chars are ignored by configuredGatewayToken().
  process.env.NOVA_MISTRAL_GATEWAY_TOKEN = "test-gateway-token-0123456789abcdef012345";
  resetMistralGatewayHealthCache();
  process.env.MISTRAL_GATEWAY_URL = "https://gateway.example.com/v1";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = ORIGINAL_FETCH;
  delete process.env.NOVA_MISTRAL_GATEWAY_TOKEN;
  delete process.env.MISTRAL_GATEWAY_URL;
  delete process.env.ZAI_API_KEY;
  delete process.env.ZAI_DEFAULT_MODEL;
});

function gatewayFetchStub(respond: (path: string) => Promise<Response> | Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.replace(/^https:\/\/gateway\.example\.com\/v1/, "");
    if (path === "/models") return modelsResponse();
    return respond(path);
  });
}

describe("Mistral gateway chat stream handling", () => {
  it("stitches streamed text and tool-call fragments into a result", async () => {
    const fetchImpl = gatewayFetchStub(() =>
      sseResponse([
        `data: ${JSON.stringify({ model: "mistral/test-model", choices: [{ delta: { content: "Let me check " } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "your files." } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "create_folder", arguments: '{"na' } }] } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'me":"A"}' } }] } }] })}\n\n`,
        "data: [DONE]\n\n",
      ])
    );
    global.fetch = fetchImpl as unknown as typeof fetch;
    const chunks: string[] = [];
    const result = await chatWithMistralGateway(1, [{ role: "user", content: "hi" }], {
      onChunk: chunk => chunks.push(chunk),
    });
    expect(result.text).toBe("Let me check your files.");
    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "create_folder", arguments: '{"name":"A"}' },
    ]);
    expect(chunks.join("")).toBe("Let me check your files.");
  });

  it("maps a clean stream with no content and no tool calls to invalid_response", async () => {
    // A gateway that closes the stream without ever sending a delta (seen on
    // long tool-calling runs) must surface as invalid_response, not a hang.
    const fetchImpl = gatewayFetchStub(() => sseResponse(["data: [DONE]\n\n"]));
    global.fetch = fetchImpl as unknown as typeof fetch;
    await expect(
      chatWithMistralGateway(1, [{ role: "user", content: "hi" }], {
        onChunk: () => {},
      })
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("retries once when a streamed completion comes back empty, then succeeds", async () => {
    // Long tool-calling runs occasionally get a 200 stream with no content
    // and no tool calls. One automatic retry absorbs the transient empty so
    // the user never sees the "invalid response" dead end.
    let calls = 0;
    const fetchImpl = gatewayFetchStub(() => {
      calls += 1;
      if (calls === 1) return sseResponse(["data: [DONE]\n\n"]);
      return sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Recovered." } }] })}\n\n`,
        "data: [DONE]\n\n",
      ]);
    });
    global.fetch = fetchImpl as unknown as typeof fetch;
    const result = await chatWithMistralGateway(
      1,
      [{ role: "user", content: "hi" }],
      { onChunk: () => {} }
    );
    expect(result.text).toBe("Recovered.");
    expect(calls).toBe(2);
  });

  it("surfaces the gateway error relayed inside an empty stream", async () => {
    const fetchImpl = gatewayFetchStub(() =>
      sseResponse([
        `data: ${JSON.stringify({ error: { message: "model overloaded" } })}\n\n`,
        "data: [DONE]\n\n",
      ])
    );
    global.fetch = fetchImpl as unknown as typeof fetch;
    await expect(
      chatWithMistralGateway(1, [{ role: "user", content: "hi" }], {
        onChunk: () => {},
      })
    ).rejects.toMatchObject({
      kind: "invalid_response",
      message: expect.stringContaining("model overloaded"),
    });
  });

  it("retries an empty buffered completion once before failing", async () => {
    // The non-streaming path (no onChunk) hits the same transient empties.
    let calls = 0;
    const fetchImpl = gatewayFetchStub(() => {
      calls += 1;
      if (calls === 1)
        return new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Back online." } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    global.fetch = fetchImpl as unknown as typeof fetch;
    const result = await chatWithMistralGateway(1, [
      { role: "user", content: "hi" },
    ]);
    expect(result.text).toBe("Back online.");
    expect(calls).toBe(2);
  });

  it("fails a stalled stream as unavailable instead of hanging forever", async () => {
    // The stream opens, headers arrive, then the gateway goes silent forever.
    const cancel = vi.fn(() => {});
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Never enqueue, never close.
      },
      cancel: () => {
        cancel();
        return Promise.resolve();
      },
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/models")) return modelsResponse();
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    global.fetch = fetchImpl as unknown as typeof fetch;

    let settled: unknown;
    const attempt = chatWithMistralGateway(1, [{ role: "user", content: "hi" }], {
      onChunk: () => {},
    }).then(
      value => {
        settled = { ok: value };
      },
      error => {
        settled = { error };
      }
    );
    // Let microtasks and the stall timer resolve without blocking the test.
    await vi.advanceTimersByTimeAsync(121_000);
    await attempt;
    expect(settled).toMatchObject({
      error: expect.objectContaining({ kind: "unavailable" }),
    });
    expect((settled as { error: Error }).error.message).toContain(
      "stopped responding"
    );
    expect(cancel).toHaveBeenCalled();
  });

  it("streams the model's private reasoning (reasoning_content) before the answer", async () => {
    const fetchImpl = gatewayFetchStub(() =>
      sseResponse([
        `data: ${JSON.stringify({ model: "mistral/test-model", choices: [{ delta: { reasoning_content: "The user wants " } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "a file listing first." } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Here are your files." } }] })}\n\n`,
        "data: [DONE]\n\n",
      ])
    );
    global.fetch = fetchImpl as unknown as typeof fetch;
    const reasoningChunks: string[] = [];
    const result = await chatWithMistralGateway(1, [{ role: "user", content: "list files" }], {
      onChunk: () => {},
      onReasoning: chunk => reasoningChunks.push(chunk),
    });
    expect(result.text).toBe("Here are your files.");
    expect(result.reasoning).toBe("The user wants a file listing first.");
    expect(reasoningChunks.join("")).toBe("The user wants a file listing first.");
  });

  it("streams Kilo-style reasoning deltas (reasoning field) before the answer", async () => {
    const fetchImpl = gatewayFetchStub(() =>
      sseResponse([
        `data: ${JSON.stringify({ model: "cohere/north-mini-code:free", choices: [{ delta: { reasoning: "The user wants " } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "a file listing first." } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Here are your files." } }] })}\n\n`,
        "data: [DONE]\n\n",
      ])
    );
    global.fetch = fetchImpl as unknown as typeof fetch;
    const reasoningChunks: string[] = [];
    const result = await chatWithMistralGateway(1, [{ role: "user", content: "list files" }], {
      onChunk: () => {},
      onReasoning: chunk => reasoningChunks.push(chunk),
    });
    expect(result.text).toBe("Here are your files.");
    expect(result.reasoning).toBe("The user wants a file listing first.");
    expect(reasoningChunks.join("")).toBe("The user wants a file listing first.");
  });

  it("captures buffered Kilo-style reasoning (reasoning field) from non-streaming completions", async () => {
    const fetchImpl = gatewayFetchStub(() =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: "Done.", reasoning: "Planned it out." } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    global.fetch = fetchImpl as unknown as typeof fetch;
    const result = await chatWithMistralGateway(1, [{ role: "user", content: "hi" }], {});
    expect(result.text).toBe("Done.");
    expect(result.reasoning).toBe("Planned it out.");
  });

  it("captures buffered reasoning wrapped as an OpenRouter-style { text } object", async () => {
    const fetchImpl = gatewayFetchStub(() =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: "Done.", reasoning: { text: "Planned it out." } } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    global.fetch = fetchImpl as unknown as typeof fetch;
    const result = await chatWithMistralGateway(1, [{ role: "user", content: "hi" }], {});
    expect(result.text).toBe("Done.");
    expect(result.reasoning).toBe("Planned it out.");
  });

  it("captures buffered reasoning_content from non-streaming completions", async () => {
    const fetchImpl = gatewayFetchStub(() =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: "Done.", reasoning_content: "Planned it out." } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    global.fetch = fetchImpl as unknown as typeof fetch;
    const result = await chatWithMistralGateway(1, [{ role: "user", content: "hi" }], {});
    expect(result.text).toBe("Done.");
    expect(result.reasoning).toBe("Planned it out.");
  });

  it("requests deep thinking for GLM-4.5+ models, with max effort on GLM-5.2+", () => {
    expect(reasoningParamsForModel("glm-4.5-flash")).toEqual({ thinking: { type: "enabled" } });
    expect(reasoningParamsForModel("glm-4.6v-flash")).toEqual({ thinking: { type: "enabled" } });
    expect(reasoningParamsForModel("glm-5.2")).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "max" });
    expect(reasoningParamsForModel("GLM-5.3-FLASH")).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "max" });
    // No unknown fields for models without a thinking mode - strict
    // endpoints must never see a parameter they do not implement.
    expect(reasoningParamsForModel("ministral-14b-latest")).toEqual({});
    expect(reasoningParamsForModel("open-mistral-nemo")).toEqual({});
  });

  it("sends the thinking fields to the provider for a GLM-family model", async () => {
    process.env.ZAI_API_KEY = "sk-zai-test-key-0123456789abcdef0123456789";
    process.env.ZAI_DEFAULT_MODEL = "glm-5.3-flash";
    let requestBody: Record<string, unknown> = {};
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/models")) return modelsResponse();
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Thought it through." } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    const result = await chatWithMistralGateway(1, [{ role: "user", content: "hi" }], {});
    expect(result.text).toBe("Thought it through.");
    expect(requestBody.model).toBe("glm-5.3-flash");
    expect(requestBody.thinking).toEqual({ type: "enabled" });
    expect(requestBody.reasoning_effort).toBe("max");
  });
});
