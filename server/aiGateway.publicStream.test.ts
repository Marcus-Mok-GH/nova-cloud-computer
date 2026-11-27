import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("./db", () => ({
  hasActiveAccessForUser: vi.fn(async () => true),
  hasProAccessForUser: vi.fn(async () => true),
  getInferenceAllowanceForUser: vi.fn(async () => ({ usedRequests: 0, updatedAt: null })),
  claimInferenceRequestForUser: vi.fn(async () => ({ usedRequests: 1 })),
}));

const {
  streamPublicAiGateway,
  resetAiGatewayHealthCache,
} = await import("./aiGateway");

const API_KEY = "sk-pol" + "k".repeat(40);
const GATEWAY_URL = "https://gateway.test/v1";

function sse(chunks: string[]): Response {
  const body =
    chunks.map(c => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("streamPublicAiGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.POLLINATIONS_FALLBACK_MODEL;
    process.env.POLLINATIONS_API_KEY = API_KEY;
    process.env.POLLINATIONS_GATEWAY_URL = GATEWAY_URL;
    delete process.env.COARENA_API_KEY;
    resetAiGatewayHealthCache();
  });

  it("sends stream:true and forwards every delta as it arrives", async () => {
    // Proves the wire contract, not just a helper: the body posted to the
    // gateway must carry stream:true and the deltas must be handed out in order.
    const order: string[] = [];
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // health probe
      .mockResolvedValueOnce(sse(["Hel", "lo ", "Nova"]));

    const result = await streamPublicAiGateway(
      [{ role: "user", content: "hi" }],
      { onChunk: chunk => order.push(chunk) }
    );

    expect(order).toEqual(["Hel", "lo ", "Nova"]);
    expect(result.text).toBe("Hello Nova");
    const completionCall = fetchMock.mock.calls.find(
      call => String(call[0]).endsWith("/chat/completions")
    );
    expect(completionCall).toBeTruthy();
    const body = JSON.parse(String(completionCall![1].body));
    expect(body.stream).toBe(true);
    expect(body.model).toBe("openai/gpt-6-luna");
  });

  it("falls back to the second model when the first fails before any delta", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // health probe
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(sse(["Fallback answer"]));

    const order: string[] = [];
    const result = await streamPublicAiGateway(
      [{ role: "user", content: "hi" }],
      { onChunk: chunk => order.push(chunk) }
    );

    expect(result.text).toBe("Fallback answer");
    expect(order).toEqual(["Fallback answer"]);
    const bodies = fetchMock.mock.calls
      .filter(call => String(call[0]).endsWith("/chat/completions"))
      .map(call => JSON.parse(String(call[1].body)).model);
    expect(bodies).toEqual(["openai/gpt-6-luna", "z-ai/glm-5.3-flash"]);
  });

  it("does not fall back after the first delta has reached the client", async () => {
    // Two answers interleaved would be worse than one failed answer: once a
    // delta is on the wire, the failure must surface instead of retrying.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // health probe
      .mockResolvedValueOnce(
        new Response(
          'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { "content-type": "text/event-stream" } }
        )
      );

    const order: string[] = [];
    await expect(
      streamPublicAiGateway([{ role: "user", content: "hi" }], {
        onChunk: chunk => order.push(chunk),
      })
    ).resolves.toMatchObject({ text: "Partial" });

    const completions = fetchMock.mock.calls.filter(call =>
      String(call[0]).endsWith("/chat/completions")
    );
    expect(completions).toHaveLength(1);
  });
});
