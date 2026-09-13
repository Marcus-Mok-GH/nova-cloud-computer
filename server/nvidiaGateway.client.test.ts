import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAllowance = vi.fn(async () => ({ usedRequests: 0, updatedAt: null }));
const claim = vi.fn(async () => ({ usedRequests: 1 }));

vi.mock("./db", () => ({
  getNvidiaInferenceAllowanceForUser: getAllowance,
  claimNvidiaInferenceRequestForUser: claim,
}));

const { completeWithNvidiaGateway, getNvidiaGatewayStatus, listNvidiaModels, resetNvidiaGatewayHealthCache, NvidiaGatewayClientError } = await import("./nvidiaGateway");

describe("NVIDIA gateway client", () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NVIDIA_GATEWAY_URL;
  const originalToken = process.env.NOVA_NVIDIA_GATEWAY_TOKEN;
  const originalNimKey = process.env.NVIDIA_API_KEY;

  beforeEach(() => {
    delete process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_GATEWAY_URL = "https://api-server-zeta.vercel.app";
    process.env.NOVA_NVIDIA_GATEWAY_TOKEN = "t".repeat(32);
    getAllowance.mockResolvedValue({ usedRequests: 0, updatedAt: null });
    claim.mockResolvedValue({ usedRequests: 1 });
    resetNvidiaGatewayHealthCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NVIDIA_GATEWAY_URL; else process.env.NVIDIA_GATEWAY_URL = originalUrl;
    if (originalToken === undefined) delete process.env.NOVA_NVIDIA_GATEWAY_TOKEN; else process.env.NOVA_NVIDIA_GATEWAY_TOKEN = originalToken;
    if (originalNimKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalNimKey;
  });

  it("uses the NVIDIA NIM API key for health and bounded completion calls", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test-key-0123456789abcdef0123456789";
    delete process.env.NOVA_NVIDIA_GATEWAY_TOKEN;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "nvidia/nemotron-3.5-lightning-30b-a3b" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Private response" } }], model: "nvidia/nemotron-3.5-lightning-30b-a3b" }), { status: 200 }));

    await expect(completeWithNvidiaGateway(7, "Summarize the release notes")).resolves.toMatchObject({ text: "Private response", allowance: { usedRequests: 1 } });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, "https://api-server-zeta.vercel.app/models", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer nvapi-test-key-0123456789abcdef0123456789" }) }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "https://api-server-zeta.vercel.app/chat/completions", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "nvidia/nemotron-3.5-lightning-30b-a3b", messages: [{ role: "user", content: "Summarize the release notes" }] }) }));
    expect(claim).toHaveBeenCalledWith(7, null);
  });

  it("reports an unconfigured gateway safely when no NVIDIA API key is present", async () => {
    delete process.env.NVIDIA_GATEWAY_URL;
    delete process.env.NOVA_NVIDIA_GATEWAY_TOKEN;
    const status = await getNvidiaGatewayStatus(7);
    expect(status).toMatchObject({ configured: false, reachable: false, providerConfigured: false });
    await expect(completeWithNvidiaGateway(7, "Draft a summary")).rejects.toBeInstanceOf(NvidiaGatewayClientError);
  });

  it("treats a successful /models round-trip as a valid, configured NIM connection", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(getNvidiaGatewayStatus(7)).resolves.toMatchObject({
      configured: true,
      reachable: true,
      providerConfigured: true,
      providerConfigurationKnown: true,
    });
  });
  it("reports an unlimited allowance when no request cap is configured", async () => {
    delete process.env.NVIDIA_MAX_REQUESTS_PER_WORKSPACE;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(getNvidiaGatewayStatus(7)).resolves.toMatchObject({
      allowance: { maxRequests: null, remainingRequests: null, exhausted: false },
    });
  });

  it("probes gateway health once and reuses the cached status within the TTL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "nvidia/nemotron-3.5-lightning-30b-a3b" }] }), { status: 200 }));

    await getNvidiaGatewayStatus(7);
    await getNvidiaGatewayStatus(7);
    await getNvidiaGatewayStatus(7);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith("https://api-server-zeta.vercel.app/models", expect.anything());
  });
  it("streams SSE deltas through onChunk and accumulates the full reply", async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" from"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" NVIDIA"}}]}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "nvidia/nemotron-3.5-lightning-30b-a3b" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } }));

    const chunks: string[] = [];
    const result = await completeWithNvidiaGateway(7, "Summarize the release notes", undefined, chunk => chunks.push(chunk));
    expect(chunks).toEqual(["Hello", " from", " NVIDIA"]);
    expect(result).toMatchObject({ text: "Hello from NVIDIA", usage: null, allowance: { usedRequests: 1 } });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "https://api-server-zeta.vercel.app/chat/completions", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "nvidia/nemotron-3.5-lightning-30b-a3b", messages: [{ role: "user", content: "Summarize the release notes" }], stream: true }) }));
  });
  it("falls back to the buffered JSON completion and emits it once when NIM does not stream", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "nvidia/nemotron-3.5-lightning-30b-a3b" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Buffered reply" } }], model: "nvidia/nemotron-3.5-lightning-30b-a3b" }), { status: 200 }));

    const chunks: string[] = [];
    const result = await completeWithNvidiaGateway(7, "Draft a summary", undefined, chunk => chunks.push(chunk));
    expect(chunks).toEqual(["Buffered reply"]);
    expect(result).toMatchObject({ text: "Buffered reply" });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "https://api-server-zeta.vercel.app/chat/completions", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "nvidia/nemotron-3.5-lightning-30b-a3b", messages: [{ role: "user", content: "Draft a summary" }], stream: true }) }));
  });
  it("discovers only text and vision-language models from NVIDIA", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "meta/llama-3.1-8b-instruct", modalities: ["text"] },
      { id: "nvidia/neva-22b", modalities: ["text", "image"] },
      // NVIDIA's OpenAI-compatible endpoint commonly returns only these core
      // fields, without task or modality metadata.
      { id: "meta/llama-3.1-70b-instruct", object: "model", owned_by: "nvidia" },
      { id: "nvidia/nv-embed-v2" },
      { id: "image-only-model", modalities: ["image"] },
      { id: "nvidia/canary-asr", modalities: ["audio"] },
      { id: "black-forest-labs/flux.1-dev", task: "image-generation" },
      { id: "nvidia/nv-rerankqa-mistral-4b-v3", task: "rerank" },
    ] }), { status: 200 }));

    await expect(listNvidiaModels(true)).resolves.toEqual([
      expect.objectContaining({ id: "meta/llama-3.1-70b-instruct", kind: "text" }),
      expect.objectContaining({ id: "meta/llama-3.1-8b-instruct", kind: "text" }),
      expect.objectContaining({ id: "nvidia/neva-22b", kind: "vision" }),
    ]);
  });
});
