import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAllowance = vi.fn(async () => ({ usedRequests: 0, updatedAt: null }));
const claim = vi.fn(async () => ({ usedRequests: 1 }));

vi.mock("./db", () => ({
  getActiveCustomModelForUser: vi.fn(async () => null),
  getMistralInferenceAllowanceForUser: getAllowance,
  claimMistralInferenceRequestForUser: claim,
}));

const { completeWithMistralGateway, getMistralGatewayStatus, listMistralModels, defaultMistralModel, configuredVisionChatModel, configuredLastResortModel, configuredKiloAnonymousHopModels, resetMistralGatewayHealthCache, resetMistralModelCache, resetMistralPoolDegradation, MistralGatewayClientError } = await import("./mistralGateway");

describe("Mistral gateway client", () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.MISTRAL_GATEWAY_URL;
  const originalToken = process.env.NOVA_MISTRAL_GATEWAY_TOKEN;
  const originalNimKey = process.env.MISTRAL_API_KEY;
  const originalDefaultModel = process.env.MISTRAL_DEFAULT_MODEL;
  const originalFallbackModel = process.env.MISTRAL_FALLBACK_MODEL;
  const originalZaiKey = process.env.ZAI_API_KEY;
  const originalZaiUrl = process.env.ZAI_GATEWAY_URL;
  const originalZaiDefaultModel = process.env.ZAI_DEFAULT_MODEL;
  const originalZaiFallbackModel = process.env.ZAI_FALLBACK_MODEL;
  const originalZaiVisionModel = process.env.ZAI_VISION_MODEL;
  const originalZaiLastResortModel = process.env.ZAI_LAST_RESORT_MODEL;
  const originalKiloGatewayUrl = process.env.KILO_GATEWAY_URL;
  const originalKiloAnonymousModel = process.env.KILO_ANONYMOUS_MODEL;
  const originalKiloAnonymousVisionModel = process.env.KILO_ANONYMOUS_VISION_MODEL;

  beforeEach(() => {
    delete process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_DEFAULT_MODEL;
    delete process.env.MISTRAL_FALLBACK_MODEL;
    delete process.env.ZAI_API_KEY;
    delete process.env.ZAI_GATEWAY_URL;
    delete process.env.ZAI_DEFAULT_MODEL;
    delete process.env.ZAI_FALLBACK_MODEL;
    delete process.env.ZAI_VISION_MODEL;
    delete process.env.ZAI_LAST_RESORT_MODEL;
    delete process.env.KILO_GATEWAY_URL;
    delete process.env.KILO_ANONYMOUS_MODEL;
    delete process.env.KILO_ANONYMOUS_VISION_MODEL;
    process.env.MISTRAL_GATEWAY_URL = "https://api-server-zeta.vercel.app";
    process.env.NOVA_MISTRAL_GATEWAY_TOKEN = "t".repeat(32);
    getAllowance.mockResolvedValue({ usedRequests: 0, updatedAt: null });
    claim.mockResolvedValue({ usedRequests: 1 });
    resetMistralGatewayHealthCache();
    resetMistralModelCache();
    resetMistralPoolDegradation();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.MISTRAL_GATEWAY_URL; else process.env.MISTRAL_GATEWAY_URL = originalUrl;
    if (originalToken === undefined) delete process.env.NOVA_MISTRAL_GATEWAY_TOKEN; else process.env.NOVA_MISTRAL_GATEWAY_TOKEN = originalToken;
    if (originalNimKey === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = originalNimKey;
    if (originalDefaultModel === undefined) delete process.env.MISTRAL_DEFAULT_MODEL; else process.env.MISTRAL_DEFAULT_MODEL = originalDefaultModel;
    if (originalFallbackModel === undefined) delete process.env.MISTRAL_FALLBACK_MODEL; else process.env.MISTRAL_FALLBACK_MODEL = originalFallbackModel;
    if (originalZaiKey === undefined) delete process.env.ZAI_API_KEY; else process.env.ZAI_API_KEY = originalZaiKey;
    if (originalZaiUrl === undefined) delete process.env.ZAI_GATEWAY_URL; else process.env.ZAI_GATEWAY_URL = originalZaiUrl;
    if (originalZaiDefaultModel === undefined) delete process.env.ZAI_DEFAULT_MODEL; else process.env.ZAI_DEFAULT_MODEL = originalZaiDefaultModel;
    if (originalZaiFallbackModel === undefined) delete process.env.ZAI_FALLBACK_MODEL; else process.env.ZAI_FALLBACK_MODEL = originalZaiFallbackModel;
    if (originalZaiVisionModel === undefined) delete process.env.ZAI_VISION_MODEL; else process.env.ZAI_VISION_MODEL = originalZaiVisionModel;
    if (originalZaiLastResortModel === undefined) delete process.env.ZAI_LAST_RESORT_MODEL; else process.env.ZAI_LAST_RESORT_MODEL = originalZaiLastResortModel;
    if (originalKiloGatewayUrl === undefined) delete process.env.KILO_GATEWAY_URL; else process.env.KILO_GATEWAY_URL = originalKiloGatewayUrl;
    if (originalKiloAnonymousModel === undefined) delete process.env.KILO_ANONYMOUS_MODEL; else process.env.KILO_ANONYMOUS_MODEL = originalKiloAnonymousModel;
    if (originalKiloAnonymousVisionModel === undefined) delete process.env.KILO_ANONYMOUS_VISION_MODEL; else process.env.KILO_ANONYMOUS_VISION_MODEL = originalKiloAnonymousVisionModel;
  });

  it("uses the Mistral AI API key for health and bounded completion calls", async () => {
    process.env.MISTRAL_API_KEY = "nvapi-test-key-0123456789abcdef0123456789";
    delete process.env.NOVA_MISTRAL_GATEWAY_TOKEN;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "mistral-large-latest" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Private response" } }], model: "mistral-large-latest" }), { status: 200 }));

    await expect(completeWithMistralGateway(7, "Summarize the release notes")).resolves.toMatchObject({ text: "Private response", allowance: { usedRequests: 1 } });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, "https://api-server-zeta.vercel.app/models", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer nvapi-test-key-0123456789abcdef0123456789" }) }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "https://api-server-zeta.vercel.app/chat/completions", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "mistral-large-latest", messages: [{ role: "user", content: "Summarize the release notes" }] }) }));
    expect(claim).toHaveBeenCalledWith(7, null);
  });

  it("reports an unconfigured gateway safely when no Mistral API key is present", async () => {
    delete process.env.MISTRAL_GATEWAY_URL;
    delete process.env.NOVA_MISTRAL_GATEWAY_TOKEN;
    const status = await getMistralGatewayStatus(7);
    expect(status).toMatchObject({ configured: false, reachable: false, providerConfigured: false });
    await expect(completeWithMistralGateway(7, "Draft a summary")).rejects.toBeInstanceOf(MistralGatewayClientError);
  });

  it("treats a successful /models round-trip as a valid, configured Mistral connection", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(getMistralGatewayStatus(7)).resolves.toMatchObject({
      configured: true,
      reachable: true,
      providerConfigured: true,
      providerConfigurationKnown: true,
    });
  });
  it("reports an unlimited allowance when no request cap is configured", async () => {
    delete process.env.MISTRAL_MAX_REQUESTS_PER_WORKSPACE;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(getMistralGatewayStatus(7)).resolves.toMatchObject({
      allowance: { maxRequests: null, remainingRequests: null, exhausted: false },
    });
  });

  it("probes gateway health once and reuses the cached status within the TTL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "mistral-large-latest" }] }), { status: 200 }));

    await getMistralGatewayStatus(7);
    await getMistralGatewayStatus(7);
    await getMistralGatewayStatus(7);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://api-server-zeta.vercel.app/models", expect.anything());
  });
  it("streams SSE deltas through onChunk and accumulates the full reply", async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" from"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" Mistral"}}]}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "mistral-large-latest" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } }));

    const chunks: string[] = [];
    const result = await completeWithMistralGateway(7, "Summarize the release notes", undefined, chunk => chunks.push(chunk));
    expect(chunks).toEqual(["Hello", " from", " Mistral"]);
    expect(result).toMatchObject({ text: "Hello from Mistral", usage: null, allowance: { usedRequests: 1 } });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "https://api-server-zeta.vercel.app/chat/completions", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "mistral-large-latest", messages: [{ role: "user", content: "Summarize the release notes" }], stream: true }) }));
  });
  it("falls back to the buffered JSON completion and emits it once when Mistral does not stream", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "mistral-large-latest" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Buffered reply" } }], model: "mistral-large-latest" }), { status: 200 }));

    const chunks: string[] = [];
    const result = await completeWithMistralGateway(7, "Draft a summary", undefined, chunk => chunks.push(chunk));
    expect(chunks).toEqual(["Buffered reply"]);
    expect(result).toMatchObject({ text: "Buffered reply" });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "https://api-server-zeta.vercel.app/chat/completions", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "mistral-large-latest", messages: [{ role: "user", content: "Draft a summary" }], stream: true }) }));
  });
  it("falls back to the pool-fallback model when the primary pool is overloaded", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "The service may be temporarily overloaded, please try again later" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "fallback reply" } }], model: "glm-4.5-flash" }), { status: 200 }));
    const result = await completeWithMistralGateway(7, "hello");
    expect(result).toMatchObject({ text: "fallback reply", model: "glm-4.5-flash" });
    // The request retried on the fallback model, and the allowance was
    // claimed once for the whole call - the retry is not double-charged.
    const chatModels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"))
      .map(call => JSON.parse(String(call[1]?.body)).model);
    expect(chatModels).toEqual(["glm-4.7-flash", "glm-4.5-flash"]);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("routes new requests straight to the pool fallback while degraded", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    // Prime the degradation: the primary pool overloads once.
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "The service may be temporarily overloaded, please try again later" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "fallback reply" } }], model: "glm-4.5-flash" }), { status: 200 }));
    await completeWithMistralGateway(7, "first");
    // Second request inside the degradation window: must skip the congested
    // primary entirely and go straight to the fallback.
    (globalThis.fetch as unknown as { mock: { mockResolvedValueOnce: (r: Response) => void } }).mock
      ? undefined : undefined;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "direct fallback" } }], model: "glm-4.5-flash" }), { status: 200 }));
    const result = await completeWithMistralGateway(7, "second");
    expect(result).toMatchObject({ text: "direct fallback", model: "glm-4.5-flash" });
    const chatModels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"))
      .map(call => JSON.parse(String(call[1]?.body)).model);
    expect(chatModels).toEqual(["glm-4.7-flash", "glm-4.5-flash", "glm-4.5-flash"]);
  });

  it("clears the degradation when every pool in the chain is overloaded", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      // The zero-key Kilo tier is the last chain element: both anonymous
      // hops are congested too, so the request finally gives up.
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: "cohere/north-mini-code:free is temporarily rate-limited upstream" } }, code: 429 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: "inclusionai/ling-3.0-flash-vl:free is temporarily rate-limited upstream" } }, code: 429 }), { status: 429 }));
    await expect(completeWithMistralGateway(7, "hello")).rejects.toMatchObject({ kind: "rate_limit" });
    // The next request must try the primary model again instead of pinning
    // to the equally-dead fallback pools.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "primary recovered" } }], model: "glm-4.7-flash" }), { status: 200 }));
    const result = await completeWithMistralGateway(7, "again");
    expect(result).toMatchObject({ text: "primary recovered", model: "glm-4.7-flash" });
    const chatModels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"))
      .map(call => JSON.parse(String(call[1]?.body)).model);
    expect(chatModels).toEqual(["glm-4.7-flash", "glm-4.5-flash", "glm-4.6v-flash", "cohere/north-mini-code:free", "inclusionai/ling-3.0-flash-vl:free", "glm-4.7-flash"]);
  });

  it("serves the request on the keyless Kilo tier when the whole Z.ai chain is congested", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "kilo reply" } }], model: "cohere/north-mini-code:free" }), { status: 200 }));
    const result = await completeWithMistralGateway(7, "hello");
    expect(result).toMatchObject({ text: "kilo reply", model: "cohere/north-mini-code:free" });
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"));
    // The Kilo attempt goes to the anonymous gateway URL and carries no
    // Authorization header: the free models are served without credentials.
    const kiloCall = calls.at(-1)!;
    expect(String(kiloCall[0])).toBe("https://api.kilo.ai/api/gateway/chat/completions");
    expect((kiloCall[1] as { headers?: Record<string, string> }).headers?.Authorization).toBeUndefined();
    const chatModels = calls.map(call => JSON.parse(String(call[1]?.body)).model);
    expect(chatModels).toEqual(["glm-4.7-flash", "glm-4.5-flash", "glm-4.6v-flash", "cohere/north-mini-code:free"]);
    // One allowance claim for the whole chain - the anonymous hops are not charged either.
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("tries the Kilo vision floor hop when the anonymous coding model is also congested", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "rate-limited upstream" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ling reply" } }], model: "inclusionai/ling-3.0-flash-vl:free" }), { status: 200 }));
    const result = await completeWithMistralGateway(7, "hello");
    expect(result).toMatchObject({ text: "ling reply", model: "inclusionai/ling-3.0-flash-vl:free" });
    const chatModels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"))
      .map(call => JSON.parse(String(call[1]?.body)).model);
    expect(chatModels).toEqual(["glm-4.7-flash", "glm-4.5-flash", "glm-4.6v-flash", "cohere/north-mini-code:free", "inclusionai/ling-3.0-flash-vl:free"]);
  });

  it("routes image turns straight to the vision-capable Kilo hop", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    // A vision turn resolves to the vision model (also the chain's last
    // resort), so the Z.ai chain is two attempts and the Kilo tier must skip
    // the text-only coding hop entirely.
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "vision reply" } }], model: "inclusionai/ling-3.0-flash-vl:free" }), { status: 200 }));
    const result = await completeWithMistralGateway(7, "hello", "glm-4.6v-flash");
    expect(result).toMatchObject({ text: "vision reply", model: "inclusionai/ling-3.0-flash-vl:free" });
    const chatModels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"))
      .map(call => JSON.parse(String(call[1]?.body)).model);
    expect(chatModels).toEqual(["glm-4.6v-flash", "glm-4.5-flash", "inclusionai/ling-3.0-flash-vl:free"]);
  });

  it("skips the Kilo tier when every anonymous hop is disabled via env", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    process.env.KILO_ANONYMOUS_MODEL = "off";
    process.env.KILO_ANONYMOUS_VISION_MODEL = "none";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }));
    await expect(completeWithMistralGateway(7, "hello")).rejects.toMatchObject({ kind: "rate_limit" });
    const chatModels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"))
      .map(call => JSON.parse(String(call[1]?.body)).model);
    expect(chatModels).toEqual(["glm-4.7-flash", "glm-4.5-flash", "glm-4.6v-flash"]);
  });

  it("keeps Mistral mode free of the anonymous Kilo tier", async () => {
    // No ZAI_API_KEY: the legacy two-tier Mistral chain must not leak into
    // the keyless tier after both pools overload.
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }));
    await expect(completeWithMistralGateway(7, "hello")).rejects.toMatchObject({ kind: "rate_limit" });
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"));
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(String(call[0])).toContain("https://api-server-zeta.vercel.app");
  });

  it("surfaces the provider error wrapped by the Kilo gateway verbatim", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: "cohere/north-mini-code:free is temporarily rate-limited upstream" } }, code: 429 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: "inclusionai/ling-3.0-flash-vl:free is temporarily rate-limited upstream" } }, code: 429 }), { status: 429 }));
    const failure = await completeWithMistralGateway(7, "hello").catch(error => error as { kind: string; message: string });
    expect(failure.kind).toBe("rate_limit");
    // The generic "Provider returned error" wrapper is replaced by the
    // provider's own error text so the chat surfaces the real cause.
    expect(failure.message).toContain("inclusionai/ling-3.0-flash-vl:free is temporarily rate-limited upstream");
    expect(failure.message).not.toContain("Provider returned error");
  });

  it("orders anonymous hops by turn type and honors env overrides", () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    // Text turns: coding hop first, vision floor second.
    expect(configuredKiloAnonymousHopModels("glm-4.7-flash"))
      .toEqual(["cohere/north-mini-code:free", "inclusionai/ling-3.0-flash-vl:free"]);
    // Vision turns: only the vision-capable hop.
    expect(configuredKiloAnonymousHopModels("glm-4.6v-flash"))
      .toEqual(["inclusionai/ling-3.0-flash-vl:free"]);
    // Operator overrides reorder nothing but replace the hop models.
    process.env.KILO_ANONYMOUS_MODEL = "poolside/laguna-s-2.1:free";
    expect(configuredKiloAnonymousHopModels("glm-4.7-flash"))
      .toEqual(["poolside/laguna-s-2.1:free", "inclusionai/ling-3.0-flash-vl:free"]);
    delete process.env.KILO_ANONYMOUS_MODEL;
    process.env.KILO_ANONYMOUS_VISION_MODEL = "";
    expect(configuredKiloAnonymousHopModels("glm-4.7-flash"))
      .toEqual(["cohere/north-mini-code:free"]);
    expect(configuredKiloAnonymousHopModels("glm-4.6v-flash")).toEqual([]);
  });

  it("falls back to the last-resort model when both pools are overloaded", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "last resort reply" } }], model: "glm-4.6v-flash" }), { status: 200 }));
    const result = await completeWithMistralGateway(7, "hello");
    expect(result).toMatchObject({ text: "last resort reply", model: "glm-4.6v-flash" });
    const chatModels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"))
      .map(call => JSON.parse(String(call[1]?.body)).model);
    // The whole chain shares one allowance claim - no double charge.
    expect(chatModels).toEqual(["glm-4.7-flash", "glm-4.5-flash", "glm-4.6v-flash"]);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("honors a ZAI_LAST_RESORT_MODEL override in the pool chain", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    process.env.ZAI_LAST_RESORT_MODEL = "glm-4.5v";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1305", message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "override reply" } }], model: "glm-4.5v" }), { status: 200 }));
    const result = await completeWithMistralGateway(7, "hello");
    expect(result).toMatchObject({ text: "override reply", model: "glm-4.5v" });
  });

  it("keeps Mistral mode two-tier: no third retry after the fallback overloads", async () => {
    // No Z.ai credential: the last-resort tier must be absent.
    process.env.MISTRAL_DEFAULT_MODEL = "mistral-medium-latest";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "mistral-medium-latest", modalities: ["text"] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 429 }));
    await expect(completeWithMistralGateway(7, "hello")).rejects.toMatchObject({ kind: "rate_limit" });
    const chatModels = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(call => String(call[0]).includes("/chat/completions"))
      .map(call => JSON.parse(String(call[1]?.body)).model);
    expect(chatModels).toEqual(["mistral-medium-latest", "ministral-8b-latest"]);
  });

  it("defaults the last-resort model to Z.ai's free vision model in Z.ai mode", () => {
    process.env.ZAI_API_KEY = "test-zai-key-0123456789abcdef0123";
    expect(configuredLastResortModel()).toBe("glm-4.6v-flash");
  });

  it("keeps Mistral-mode pool chains two-tier (no last-resort model)", () => {
    expect(process.env.ZAI_API_KEY).toBeUndefined();
    expect(configuredLastResortModel()).toBeUndefined();
  });

  it("switches to the Z.ai transport and env var names when ZAI_API_KEY is set", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "glm-4.7-flash", modalities: ["text"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://api.z.ai/api/paas/v4/models", expect.anything());
    expect(status).toMatchObject({ reachable: true });
  });

  it("honors ZAI_DEFAULT_MODEL when a Z.ai credential is configured", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    process.env.ZAI_FALLBACK_MODEL = "glm-4.5-flash";
    // The legacy Mistral override must be ignored in Z.ai mode.
    process.env.MISTRAL_DEFAULT_MODEL = "ministral-8b-latest";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "glm-4.7-flash", modalities: ["text"] },
      { id: "glm-4.5-flash", modalities: ["text"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status).toMatchObject({ model: "glm-4.7-flash", reachable: true });
    expect(defaultMistralModel()).toBe("glm-4.7-flash");
  });

  it("respects ZAI_GATEWAY_URL as the Z.ai base URL override", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_GATEWAY_URL = "https://zai-mirror.example.com/v4";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await getMistralGatewayStatus(7);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://zai-mirror.example.com/v4/models", expect.anything());
  });

  it("defaults the vision model to Z.ai's free vision model in Z.ai mode", () => {
    process.env.ZAI_API_KEY = "test-zai-key-0123456789abcdef0123";
    expect(configuredVisionChatModel()).toBe("glm-4.6v-flash");
  });

  it("honors a ZAI_VISION_MODEL override in Z.ai mode", () => {
    process.env.ZAI_API_KEY = "test-zai-key-0123456789abcdef0123";
    process.env.ZAI_VISION_MODEL = "glm-4.5v";
    expect(configuredVisionChatModel()).toBe("glm-4.5v");
  });

  it("keeps Mistral-mode vision resolution discovery-based (no override)", () => {
    expect(process.env.ZAI_API_KEY).toBeUndefined();
    expect(configuredVisionChatModel()).toBeUndefined();
  });

  it("trusts a ZAI_DEFAULT_MODEL the gateway does not list (z.ai serves unlisted free models)", async () => {
    process.env.ZAI_API_KEY = "z".repeat(40);
    process.env.ZAI_DEFAULT_MODEL = "glm-4.7-flash";
    // Only paid models come back from /models - the free flash models are
    // served but unlisted. The override must not degrade to glm-4.5.
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "glm-4.5" },
      { id: "glm-4.7" },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status).toMatchObject({ model: "glm-4.7-flash", reachable: true });
    expect(defaultMistralModel()).toBe("glm-4.7-flash");
  });

  it("keeps the legacy Mistral transport when no Z.ai credential is set", async () => {
    process.env.MISTRAL_DEFAULT_MODEL = "glm-4.7-flash";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "ministral-14b-latest", modalities: ["text"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://api-server-zeta.vercel.app/models", expect.anything());
    // The unserved override degrades to the served model instead of stranding the agent on a 404 id.
    expect(status).toMatchObject({ model: "ministral-14b-latest", reachable: true });
    expect(defaultMistralModel()).toBe("ministral-14b-latest");
  });

  it("honors a MISTRAL_DEFAULT_MODEL override when the gateway serves it", async () => {
    process.env.MISTRAL_DEFAULT_MODEL = "glm-4.7-flash";
    process.env.MISTRAL_FALLBACK_MODEL = "glm-4.5-flash";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "glm-4.7-flash", modalities: ["text"] },
      { id: "glm-4.5-flash", modalities: ["text"] },
      { id: "glm-4.6v-flash", modalities: ["text", "image"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status).toMatchObject({ model: "glm-4.7-flash", reachable: true });
    expect(defaultMistralModel()).toBe("glm-4.7-flash");
  });

  it("ignores a MISTRAL_DEFAULT_MODEL override the gateway does not serve", async () => {
    process.env.MISTRAL_DEFAULT_MODEL = "glm-4.7-flash";
    process.env.MISTRAL_FALLBACK_MODEL = "glm-4.5-flash";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "ministral-14b-latest", modalities: ["text"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status.model).toBe("ministral-14b-latest");
    expect(defaultMistralModel()).toBe("ministral-14b-latest");
  });

  it("falls back to a configured text fallback on an unserved default", async () => {
    process.env.MISTRAL_DEFAULT_MODEL = "glm-5.3";
    process.env.MISTRAL_FALLBACK_MODEL = "glm-4.5-flash";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "glm-4.7-flash", modalities: ["text"] },
      { id: "glm-4.5-flash", modalities: ["text"] },
    ] }), { status: 200 }));
    await getMistralGatewayStatus(7);
    expect(defaultMistralModel()).toBe("glm-4.5-flash");
  });

  it("defaults to the hardcoded ministral-14b model whenever it is served", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-large-latest", modalities: ["text"] },
      { id: "ministral-14b-latest", modalities: ["text"] },
      { id: "mistral-omni-latest", modalities: ["text", "image", "audio", "video"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status).toMatchObject({ model: "ministral-14b-latest", reachable: true });
    expect(defaultMistralModel()).toBe("ministral-14b-latest");
  });

  it("degrades to a vision model when the hardcoded default is not served", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-medium-latest", modalities: ["text"] },
      { id: "mistral-omni-latest", modalities: ["text", "image", "audio", "video"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status.model).toBe("mistral-omni-latest");
  });

  it("prefers a medium-family vision model over the deprecated pixtral family", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "pixtral-12b-2409", modalities: ["text", "image"] },
      { id: "mistral-medium-3-1", modalities: ["text", "image", "audio", "video"] },
    ] }), { status: 200 }));
    await getMistralGatewayStatus(7);
    expect(defaultMistralModel()).toBe("mistral-medium-3-1");
  });

  it("falls back to a discovered text model when no vision model is available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-medium-latest", modalities: ["text"] },
      { id: "mistral-large-latest", modalities: ["text"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    // Discovery sorts alphabetically, and neither fixture is the hardcoded
    // text fallback (mistral-small-latest), so the first discovered text model
    // is chosen instead of the unserved hardcoded fallback.
    expect(status.model).toBe("mistral-large-latest");
  });

  it("detects vision models by id when the gateway returns no modality metadata", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-large-latest" },
      { id: "pixtral-12b-2409", object: "model", owned_by: "mistral" },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status.model).toBe("pixtral-12b-2409");
  });

  it("maps permanent 4xx completion failures to a non-retryable client error", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "mistral-medium-3-5", modalities: ["text", "image"] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 400 }));
    await expect(completeWithMistralGateway(7, "hello")).rejects.toMatchObject({
      kind: "client_error",
      message: "Model not found",
    });
  });

  it("maps oversized-prompt failures (413) to a non-retryable client error", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "mistral-medium-3-5", modalities: ["text", "image"] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Payload too large" } }), { status: 413 }));
    await expect(completeWithMistralGateway(7, "hello")).rejects.toMatchObject({
      kind: "client_error",
      message: "Payload too large",
    });
  });

  it("keeps 5xx completion failures retryable as unavailable", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "mistral-medium-3-5", modalities: ["text", "image"] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "upstream exploded" } }), { status: 502 }));
    await expect(completeWithMistralGateway(7, "hello")).rejects.toMatchObject({
      kind: "unavailable",
      message: "upstream exploded",
    });
  });

  it("reports a 401 from model discovery as a provider configuration problem", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 }));
    // The status call must not reject: it reports the broken credential as
    // flags so the UI can say the gateway needs an administrator fix.
    const status = await getMistralGatewayStatus(7);
    expect(status).toMatchObject({
      reachable: false,
      providerConfigurationKnown: true,
      providerConfigured: false,
    });
  });

  it("discovers only text and vision-language models from Mistral", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-small-latest", modalities: ["text"] },
      { id: "pixtral-12b-2409", modalities: ["text", "image"] },
      // Mistral's OpenAI-compatible endpoint commonly returns only these core
      // fields, without task or modality metadata.
      { id: "open-mistral-nemo", object: "model", owned_by: "mistral" },
      { id: "mistral-embed" },
      { id: "image-only-model", modalities: ["image"] },
      { id: "voxtral-mini", modalities: ["audio"] },
      { id: "flux.1-dev", task: "image-generation" },
      { id: "mistral-rerank", task: "rerank" },
      // Omni models understand audio and video alongside text and images -
      // they stay eligible as vision chat models.
      { id: "mistral-omni-latest", modalities: ["text", "image", "audio", "video"] },
    ] }), { status: 200 }));

    await expect(listMistralModels(true)).resolves.toEqual([
      expect.objectContaining({ id: "mistral-omni-latest", kind: "vision" }),
      expect.objectContaining({ id: "mistral-small-latest", kind: "text" }),
      expect.objectContaining({ id: "open-mistral-nemo", kind: "text" }),
      expect.objectContaining({ id: "pixtral-12b-2409", kind: "vision" }),
    ]);
  });
});
