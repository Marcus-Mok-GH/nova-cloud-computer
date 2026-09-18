import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAllowance = vi.fn(async () => ({ usedRequests: 0, updatedAt: null }));
const claim = vi.fn(async () => ({ usedRequests: 1 }));

vi.mock("./db", () => ({
  getMistralInferenceAllowanceForUser: getAllowance,
  claimMistralInferenceRequestForUser: claim,
}));

const { completeWithMistralGateway, getMistralGatewayStatus, listMistralModels, defaultMistralModel, resetMistralGatewayHealthCache, resetMistralModelCache, MistralGatewayClientError } = await import("./mistralGateway");

describe("Mistral gateway client", () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.MISTRAL_GATEWAY_URL;
  const originalToken = process.env.NOVA_MISTRAL_GATEWAY_TOKEN;
  const originalNimKey = process.env.MISTRAL_API_KEY;

  beforeEach(() => {
    delete process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_GATEWAY_URL = "https://api-server-zeta.vercel.app";
    process.env.NOVA_MISTRAL_GATEWAY_TOKEN = "t".repeat(32);
    getAllowance.mockResolvedValue({ usedRequests: 0, updatedAt: null });
    claim.mockResolvedValue({ usedRequests: 1 });
    resetMistralGatewayHealthCache();
    resetMistralModelCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.MISTRAL_GATEWAY_URL; else process.env.MISTRAL_GATEWAY_URL = originalUrl;
    if (originalToken === undefined) delete process.env.NOVA_MISTRAL_GATEWAY_TOKEN; else process.env.NOVA_MISTRAL_GATEWAY_TOKEN = originalToken;
    if (originalNimKey === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = originalNimKey;
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
  it("defaults to the hardcoded Pixtral Large vision model whenever it is served", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-large-latest", modalities: ["text"] },
      { id: "pixtral-large-latest", modalities: ["text", "image"] },
      { id: "mistral-omni-latest", modalities: ["text", "image", "audio", "video"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status).toMatchObject({ model: "pixtral-large-latest", reachable: true });
    expect(defaultMistralModel()).toBe("pixtral-large-latest");
  });

  it("degrades to another vision model when Pixtral Large is not served", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-medium-latest", modalities: ["text"] },
      { id: "mistral-omni-latest", modalities: ["text", "image", "audio", "video"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
    expect(status.model).toBe("mistral-omni-latest");
  });

  it("prefers a pixtral vision model when the hardcoded default is not served", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-omni-latest", modalities: ["text", "image", "audio", "video"] },
      { id: "pixtral-12b-2409", modalities: ["text", "image"] },
    ] }), { status: 200 }));
    await getMistralGatewayStatus(7);
    expect(defaultMistralModel()).toBe("pixtral-12b-2409");
  });

  it("falls back to the text model when no vision model is available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "mistral-large-latest", modalities: ["text"] },
      { id: "mistral-small-latest", modalities: ["text"] },
    ] }), { status: 200 }));
    const status = await getMistralGatewayStatus(7);
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
