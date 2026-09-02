import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAllowance = vi.fn(async () => ({ usedRequests: 0, updatedAt: null }));
const claim = vi.fn(async () => ({ usedRequests: 1 }));

vi.mock("./db", () => ({
  getNvidiaInferenceAllowanceForUser: getAllowance,
  claimNvidiaInferenceRequestForUser: claim,
}));

const { completeWithNvidiaGateway, getNvidiaGatewayStatus, listNvidiaModels, NvidiaGatewayClientError } = await import("./nvidiaGateway");

describe("NVIDIA gateway client", () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NVIDIA_GATEWAY_URL;
  const originalToken = process.env.NOVA_NVIDIA_GATEWAY_TOKEN;

  beforeEach(() => {
    process.env.NVIDIA_GATEWAY_URL = "https://api-server-zeta.vercel.app";
    process.env.NOVA_NVIDIA_GATEWAY_TOKEN = "t".repeat(32);
    getAllowance.mockResolvedValue({ usedRequests: 0, updatedAt: null });
    claim.mockResolvedValue({ usedRequests: 1 });
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NVIDIA_GATEWAY_URL; else process.env.NVIDIA_GATEWAY_URL = originalUrl;
    if (originalToken === undefined) delete process.env.NOVA_NVIDIA_GATEWAY_TOKEN; else process.env.NOVA_NVIDIA_GATEWAY_TOKEN = originalToken;
  });

  it("uses the server-only service token for health and bounded completion calls", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", providerConfigured: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "Private response", model: "nvidia/nemotron-3-nano-30b-a3b" }), { status: 200 }));

    await expect(completeWithNvidiaGateway(7, "Summarize the release notes")).resolves.toMatchObject({ text: "Private response", allowance: { usedRequests: 1 } });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, "https://api-server-zeta.vercel.app/api/nvidia/health", expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${"t".repeat(32)}` }) }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "https://api-server-zeta.vercel.app/api/nvidia/chat", expect.objectContaining({ method: "POST", body: JSON.stringify({ prompt: "Summarize the release notes" }) }));
    expect(claim).toHaveBeenCalledWith(7, 50);
  });

  it("reports an unconfigured gateway safely without making a browser-reachable provider call", async () => {
    delete process.env.NVIDIA_GATEWAY_URL;
    const status = await getNvidiaGatewayStatus(7);
    expect(status).toMatchObject({ configured: false, reachable: false, providerConfigured: false });
    await expect(completeWithNvidiaGateway(7, "Draft a summary")).rejects.toBeInstanceOf(NvidiaGatewayClientError);
  });

  it("keeps a successful gateway reachable when a health response body is unavailable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(getNvidiaGatewayStatus(7)).resolves.toMatchObject({
      configured: true,
      reachable: true,
      providerConfigured: false,
      providerConfigurationKnown: false,
    });
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
