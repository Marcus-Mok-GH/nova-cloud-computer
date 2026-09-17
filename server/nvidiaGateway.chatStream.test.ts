import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise the raw gateway stream handling in chatWithNvidiaGateway
// with a stubbed global fetch - the paths that turn a long tool-calling reply
// into "NVIDIA returned an invalid response" or a hung webhook.

vi.mock("./db", () => ({
  getNvidiaInferenceAllowanceForUser: vi.fn(async () => ({ usedRequests: 0 })),
  claimNvidiaInferenceRequestForUser: vi.fn(async () => ({ usedRequests: 1 })),
}));

import { chatWithNvidiaGateway, resetNvidiaGatewayHealthCache } from "./nvidiaGateway";

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
    JSON.stringify({ data: [{ id: "nvidia/test-model" }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

beforeEach(() => {
  // Tokens shorter than 32 chars are ignored by configuredGatewayToken().
  process.env.NOVA_NVIDIA_GATEWAY_TOKEN = "test-gateway-token-0123456789abcdef012345";
  resetNvidiaGatewayHealthCache();
  process.env.NVIDIA_GATEWAY_URL = "https://gateway.example.com/v1";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = ORIGINAL_FETCH;
  delete process.env.NOVA_NVIDIA_GATEWAY_TOKEN;
  delete process.env.NVIDIA_GATEWAY_URL;
});

function gatewayFetchStub(respond: (path: string) => Promise<Response> | Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.replace(/^https:\/\/gateway\.example\.com\/v1/, "");
    if (path === "/models") return modelsResponse();
    return respond(path);
  });
}

describe("NVIDIA gateway chat stream handling", () => {
  it("stitches streamed text and tool-call fragments into a result", async () => {
    const fetchImpl = gatewayFetchStub(() =>
      sseResponse([
        `data: ${JSON.stringify({ model: "nvidia/test-model", choices: [{ delta: { content: "Let me check " } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "your files." } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "create_folder", arguments: '{"na' } }] } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'me":"A"}' } }] } }] })}\n\n`,
        "data: [DONE]\n\n",
      ])
    );
    global.fetch = fetchImpl as unknown as typeof fetch;
    const chunks: string[] = [];
    const result = await chatWithNvidiaGateway(1, [{ role: "user", content: "hi" }], {
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
      chatWithNvidiaGateway(1, [{ role: "user", content: "hi" }], {
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
    const result = await chatWithNvidiaGateway(
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
      chatWithNvidiaGateway(1, [{ role: "user", content: "hi" }], {
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
    const result = await chatWithNvidiaGateway(1, [
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
    const attempt = chatWithNvidiaGateway(1, [{ role: "user", content: "hi" }], {
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
});
