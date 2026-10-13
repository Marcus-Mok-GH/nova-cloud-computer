import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAllowance = vi.fn(async () => ({ usedRequests: 0, updatedAt: null }));
const claim = vi.fn(async () => ({ usedRequests: 1 }));

vi.mock("./db", () => ({
  claimDailyCreditForUser: vi.fn(async () => ({ usedCredits: 1, allocatedCredits: 500 })),
  settleDailyCreditUsageForUser: vi.fn(async () => undefined),
  getActiveCustomModelForUser: vi.fn(async () => null),
  getInferenceAllowanceForUser: getAllowance,
  claimInferenceRequestForUser: claim,
}));

const {
  chatWithAiGateway,
  completeWithAiGateway,
  getAiGatewayStatus,
  listGatewayModels,
  resetAiGatewayHealthCache,
  TOKENHARBOR_CHAT_MODEL,
  TOKENHARBOR_FALLBACK_MODEL,
  TOKENHARBOR_SECOND_FALLBACK_MODEL,
  SEEKAI_FALLBACK_MODEL,
  AiGatewayClientError,
} = await import("./aiGateway");

const TOKENHARBOR_BASE_URL = "https://tokenharbor.ai/v1";
const MIRROR_URL = "https://token-harbor-mirror.example.com/v1";
const API_KEY = "thk_live_" + "k".repeat(40);
const SEEKAI_URL = "https://seekai.example.com/v1";
const SEEKAI_KEY = "sk_seekai_" + "s".repeat(40);

/** The chat-completion model ids sent across every fetch call, in order. */
function postedModels() {
  return (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls
    .filter(call => String(call[0]).includes("/chat/completions"))
    .map(call => (JSON.parse(String(call[1]?.body)) as { model: string }).model);
}

/** The fetch calls made against the SeekAI endpoint, in order. */
function seekaiCalls() {
  return (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls
    .filter(call => String(call[0]).startsWith(SEEKAI_URL));
}

describe("AI gateway client", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOKENHARBOR_API_KEY;
  const originalUrl = process.env.TOKENHARBOR_GATEWAY_URL;
  const originalFallback = process.env.TOKENHARBOR_FALLBACK_MODEL;
  const originalSecondFallback = process.env.TOKENHARBOR_SECOND_FALLBACK_MODEL;
  const originalSeekaiKey = process.env.SEEKAI_API_KEY;
  const originalSeekaiUrl = process.env.SEEKAI_GATEWAY_URL;
  const originalSeekaiFallback = process.env.SEEKAI_FALLBACK_MODEL;

  beforeEach(() => {
    delete process.env.TOKENHARBOR_API_KEY;
    delete process.env.TOKENHARBOR_GATEWAY_URL;
    delete process.env.TOKENHARBOR_FALLBACK_MODEL;
    delete process.env.TOKENHARBOR_SECOND_FALLBACK_MODEL;
    delete process.env.SEEKAI_API_KEY;
    delete process.env.SEEKAI_GATEWAY_URL;
    delete process.env.SEEKAI_FALLBACK_MODEL;
    process.env.TOKENHARBOR_API_KEY = API_KEY;
    process.env.TOKENHARBOR_GATEWAY_URL = MIRROR_URL;
    getAllowance.mockResolvedValue({ usedRequests: 0, updatedAt: null });
    claim.mockResolvedValue({ usedRequests: 1 });
    resetAiGatewayHealthCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOKENHARBOR_API_KEY; else process.env.TOKENHARBOR_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.TOKENHARBOR_GATEWAY_URL; else process.env.TOKENHARBOR_GATEWAY_URL = originalUrl;
    if (originalFallback === undefined) delete process.env.TOKENHARBOR_FALLBACK_MODEL; else process.env.TOKENHARBOR_FALLBACK_MODEL = originalFallback;
    if (originalSecondFallback === undefined) delete process.env.TOKENHARBOR_SECOND_FALLBACK_MODEL; else process.env.TOKENHARBOR_SECOND_FALLBACK_MODEL = originalSecondFallback;
    if (originalSeekaiKey === undefined) delete process.env.SEEKAI_API_KEY; else process.env.SEEKAI_API_KEY = originalSeekaiKey;
    if (originalSeekaiUrl === undefined) delete process.env.SEEKAI_GATEWAY_URL; else process.env.SEEKAI_GATEWAY_URL = originalSeekaiUrl;
    if (originalSeekaiFallback === undefined) delete process.env.SEEKAI_FALLBACK_MODEL; else process.env.SEEKAI_FALLBACK_MODEL = originalSeekaiFallback;
  });

  it("targets Token Harbor's base URL by default", async () => {
    delete process.env.TOKENHARBOR_GATEWAY_URL;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await getAiGatewayStatus(7);
    expect(globalThis.fetch).toHaveBeenCalledWith(`${TOKENHARBOR_BASE_URL}/models`, expect.anything());
  });

  it("honors TOKENHARBOR_GATEWAY_URL as the base URL override", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await getAiGatewayStatus(7);
    expect(globalThis.fetch).toHaveBeenCalledWith(`${MIRROR_URL}/models`, expect.anything());
  });

  it("reports the single built-in model in status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(getAiGatewayStatus(7)).resolves.toMatchObject({
      configured: true,
      reachable: true,
      providerConfigured: true,
      providerConfigurationKnown: true,
      model: TOKENHARBOR_CHAT_MODEL,
    });
  });

  it("reports an unconfigured gateway safely when no credential is present", async () => {
    delete process.env.TOKENHARBOR_API_KEY;
    const status = await getAiGatewayStatus(7);
    expect(status).toMatchObject({ configured: false, reachable: false, providerConfigured: false });
    await expect(completeWithAiGateway(7, "Draft a summary")).rejects.toBeInstanceOf(AiGatewayClientError);
  });

  it("reports an unlimited allowance when no request cap is configured", async () => {
    delete process.env.TOKENHARBOR_MAX_REQUESTS_PER_WORKSPACE;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(getAiGatewayStatus(7)).resolves.toMatchObject({
      allowance: { maxRequests: null, remainingRequests: null, exhausted: false },
    });
  });

  it("probes gateway health once and reuses the cached status within the TTL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await getAiGatewayStatus(7);
    await getAiGatewayStatus(7);
    await getAiGatewayStatus(7);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(`${MIRROR_URL}/models`, expect.anything());
  });

  it("posts the single model with the bearer key on complete", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Private response" } }], model: TOKENHARBOR_CHAT_MODEL }), { status: 200 }));

    await expect(completeWithAiGateway(7, "Summarize the release notes")).resolves.toMatchObject({ text: "Private response", allowance: { usedRequests: 1 } });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, `${MIRROR_URL}/models`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }) }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, `${MIRROR_URL}/chat/completions`, expect.objectContaining({ method: "POST", body: JSON.stringify({ model: TOKENHARBOR_CHAT_MODEL, messages: [{ role: "user", content: "Summarize the release notes" }] }) }));
    expect(claim).toHaveBeenCalledWith(7, null);
  });

  it("falls back to Claude Haiku when the primary model is overloaded", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "fallback reply" } }], model: TOKENHARBOR_FALLBACK_MODEL }), { status: 200 }));

    await expect(completeWithAiGateway(7, "hello")).resolves.toMatchObject({ text: "fallback reply" });
    // Primary first, then the Haiku fallback; one allowance claim for both.
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL, TOKENHARBOR_FALLBACK_MODEL]);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("falls back to MiMo when the primary and Haiku models are overloaded", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "mimo reply" } }], model: TOKENHARBOR_SECOND_FALLBACK_MODEL }), { status: 200 }));

    await expect(completeWithAiGateway(7, "hello")).resolves.toMatchObject({ text: "mimo reply" });
    // Primary first, then Haiku, then MiMo; one allowance claim for all three.
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL, TOKENHARBOR_FALLBACK_MODEL, TOKENHARBOR_SECOND_FALLBACK_MODEL]);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  /** A fetch stub that fails every Token Harbor completion and serves SeekAI. */
  function overloadedTokenHarborThenSeekai() {
    const overloaded = () =>
      new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 });
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${MIRROR_URL}/models`) return new Response(null, { status: 200 });
      if (url.startsWith(SEEKAI_URL)) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "seekai reply" } }],
            model: SEEKAI_FALLBACK_MODEL,
          }),
          { status: 200 }
        );
      }
      return overloaded();
    });
  }

  it("falls back to SeekAI's GLM-5.3-Flash when every Token Harbor model fails transiently", async () => {
    process.env.SEEKAI_API_KEY = SEEKAI_KEY;
    process.env.SEEKAI_GATEWAY_URL = SEEKAI_URL;
    globalThis.fetch = overloadedTokenHarborThenSeekai() as unknown as typeof fetch;

    await expect(completeWithAiGateway(7, "hello")).resolves.toMatchObject({ text: "seekai reply" });
    // Primary, Haiku, MiMo, then SeekAI - all four attempts on one allowance claim.
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL, TOKENHARBOR_FALLBACK_MODEL, TOKENHARBOR_SECOND_FALLBACK_MODEL, SEEKAI_FALLBACK_MODEL]);
    expect(claim).toHaveBeenCalledTimes(1);
    const [url, init] = seekaiCalls()[0] ?? [];
    expect(url).toBe(`${SEEKAI_URL}/chat/completions`);
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe(`Bearer ${SEEKAI_KEY}`);
  });

  it("routes the chat path's last resort to SeekAI with its own credential", async () => {
    process.env.SEEKAI_API_KEY = SEEKAI_KEY;
    process.env.SEEKAI_GATEWAY_URL = SEEKAI_URL;
    globalThis.fetch = overloadedTokenHarborThenSeekai() as unknown as typeof fetch;

    const result = await chatWithAiGateway(7, [{ role: "user", content: "hello" }], {});
    expect(result).toMatchObject({ text: "seekai reply", model: SEEKAI_FALLBACK_MODEL });
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL, TOKENHARBOR_FALLBACK_MODEL, TOKENHARBOR_SECOND_FALLBACK_MODEL, SEEKAI_FALLBACK_MODEL]);
    expect(seekaiCalls()).toHaveLength(1);
  });

  it("keeps the chain on Token Harbor when no SeekAI credential is configured", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }));

    await expect(completeWithAiGateway(7, "hello")).rejects.toMatchObject({ kind: "rate_limit" });
    // Three attempts, all against Token Harbor: the SeekAI hop is skipped.
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL, TOKENHARBOR_FALLBACK_MODEL, TOKENHARBOR_SECOND_FALLBACK_MODEL]);
    expect(seekaiCalls()).toHaveLength(0);
  });

  it("ignores a SeekAI credential that is too short to be a real key", async () => {
    process.env.SEEKAI_API_KEY = "sk-short";
    process.env.SEEKAI_GATEWAY_URL = SEEKAI_URL;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }));

    await expect(completeWithAiGateway(7, "hello")).rejects.toMatchObject({ kind: "rate_limit" });
    expect(seekaiCalls()).toHaveLength(0);
  });

  it("turns the SeekAI hop off with SEEKAI_FALLBACK_MODEL=disabled", async () => {
    process.env.SEEKAI_API_KEY = SEEKAI_KEY;
    process.env.SEEKAI_GATEWAY_URL = SEEKAI_URL;
    process.env.SEEKAI_FALLBACK_MODEL = "disabled";
    globalThis.fetch = overloadedTokenHarborThenSeekai() as unknown as typeof fetch;

    await expect(completeWithAiGateway(7, "hello")).rejects.toMatchObject({ kind: "rate_limit" });
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL, TOKENHARBOR_FALLBACK_MODEL, TOKENHARBOR_SECOND_FALLBACK_MODEL]);
    expect(seekaiCalls()).toHaveLength(0);
  });

  it("lists the SeekAI last resort only while its credential is configured", async () => {
    await expect(listGatewayModels(true)).resolves.toEqual([
      { id: TOKENHARBOR_CHAT_MODEL, kind: "vision" },
      { id: TOKENHARBOR_FALLBACK_MODEL, kind: "vision" },
      { id: TOKENHARBOR_SECOND_FALLBACK_MODEL, kind: "vision" },
    ]);

    process.env.SEEKAI_API_KEY = SEEKAI_KEY;
    await expect(listGatewayModels(true)).resolves.toEqual([
      { id: TOKENHARBOR_CHAT_MODEL, kind: "vision" },
      { id: TOKENHARBOR_FALLBACK_MODEL, kind: "vision" },
      { id: TOKENHARBOR_SECOND_FALLBACK_MODEL, kind: "vision" },
      { id: SEEKAI_FALLBACK_MODEL, kind: "text" },
    ]);
  });

  it("does not fall back on permanent client errors", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }));

    await expect(completeWithAiGateway(7, "hello")).rejects.toMatchObject({ kind: "client_error" });
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL]);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("streams SSE deltas through onChunk and accumulates the full reply", async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" from"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" Nova"}}]}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } }));

    const chunks: string[] = [];
    const result = await completeWithAiGateway(7, "Summarize the release notes", undefined, chunk => chunks.push(chunk));
    expect(chunks).toEqual(["Hello", " from", " Nova"]);
    expect(result).toMatchObject({ text: "Hello from Nova", usage: null, allowance: { usedRequests: 1 } });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, `${MIRROR_URL}/chat/completions`, expect.objectContaining({ method: "POST", body: JSON.stringify({ model: TOKENHARBOR_CHAT_MODEL, messages: [{ role: "user", content: "Summarize the release notes" }], stream: true }) }));
  });

  it("emits the buffered JSON completion once when the provider does not stream", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Buffered reply" } }], model: TOKENHARBOR_CHAT_MODEL }), { status: 200 }));

    const chunks: string[] = [];
    const result = await completeWithAiGateway(7, "Draft a summary", undefined, chunk => chunks.push(chunk));
    expect(chunks).toEqual(["Buffered reply"]);
    expect(result).toMatchObject({ text: "Buffered reply" });
  });

  it("posts the single model from chatWithAiGateway", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "chat reply" } }], model: TOKENHARBOR_CHAT_MODEL }), { status: 200 }));

    const result = await chatWithAiGateway(7, [{ role: "user", content: "hello" }], {});
    expect(result).toMatchObject({ text: "chat reply", model: TOKENHARBOR_CHAT_MODEL });
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL]);
  });

  it("ignores any caller-supplied model override", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "one" } }], model: TOKENHARBOR_CHAT_MODEL }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "two" } }], model: TOKENHARBOR_CHAT_MODEL }), { status: 200 }));

    await completeWithAiGateway(7, "hi", "claude-opus-5.5");
    await chatWithAiGateway(7, [{ role: "user", content: "hi" }], { model: "gpt-6-astra" });
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL, TOKENHARBOR_CHAT_MODEL]);
  });

  it("maps permanent 4xx completion failures to a non-retryable client error", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 400 }));

    await expect(completeWithAiGateway(7, "hello")).rejects.toMatchObject({
      kind: "client_error",
      message: "Model not found",
    });
  });

  it("maps oversized-prompt failures (413) to a non-retryable client error", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Payload too large" } }), { status: 413 }));

    await expect(completeWithAiGateway(7, "hello")).rejects.toMatchObject({
      kind: "client_error",
      message: "Payload too large",
    });
  });

  it("keeps 5xx completion failures retryable as unavailable", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "upstream exploded" } }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "upstream exploded" } }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "upstream exploded" } }), { status: 502 }));

    await expect(completeWithAiGateway(7, "hello")).rejects.toMatchObject({
      kind: "unavailable",
      message: "upstream exploded",
    });
    // Primary and both fallbacks failed; the last fallback's error surfaces.
    expect(postedModels()).toEqual([TOKENHARBOR_CHAT_MODEL, TOKENHARBOR_FALLBACK_MODEL, TOKENHARBOR_SECOND_FALLBACK_MODEL]);
  });

  it("reports a 401 from the health probe as a provider configuration problem", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 }));

    // The status call must not reject: it reports the broken credential as
    // flags so the UI can say the gateway needs an administrator fix.
    const status = await getAiGatewayStatus(7);
    expect(status).toMatchObject({
      reachable: false,
      providerConfigurationKnown: true,
      providerConfigured: false,
    });
  });

  it("exposes the primary model and both fallbacks", async () => {
    await expect(listGatewayModels(true)).resolves.toEqual([
      { id: TOKENHARBOR_CHAT_MODEL, kind: "vision" },
      { id: TOKENHARBOR_FALLBACK_MODEL, kind: "vision" },
      { id: TOKENHARBOR_SECOND_FALLBACK_MODEL, kind: "vision" },
    ]);
  });
});
