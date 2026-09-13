import { claimNvidiaInferenceRequestForUser, getNvidiaInferenceAllowanceForUser } from "./db";

const DEFAULT_MAX_REQUESTS = 50;
const MAX_CONFIGURED_REQUESTS = 1000;
const REQUEST_TIMEOUT_MS = 100_000;
const ERROR_MESSAGE_LIMIT = 600;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const HEALTH_CACHE_TTL_MS = 10_000;

type GatewayCompletion = {
  text?: string;
  model?: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

type NvidiaModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  root?: string;
  task?: string;
  capabilities?: string[] | Record<string, unknown>;
  supported_modalities?: string[];
  modalities?: string[];
};

type NvidiaModelsResponse = {
  data?: NvidiaModel[];
};

export type AvailableNvidiaModel = NvidiaModel & {
  /** Models in the picker always support chat; vision models also accept image input. */
  kind: "text" | "vision";
};

let modelCache: { models: AvailableNvidiaModel[]; expiresAt: number } | undefined;

type GatewayHealthFlags = {
  configured: boolean;
  reachable: boolean;
  providerConfigured: boolean;
  providerConfigurationKnown: boolean;
};

let gatewayHealthCache:
  | { key: string; expiresAt: number; flags: GatewayHealthFlags }
  | undefined;

/** Clears the in-process gateway health cache (used by tests between cases). */
export function resetNvidiaGatewayHealthCache() {
  gatewayHealthCache = undefined;
}

export class NvidiaGatewayClientError extends Error {
  constructor(message: string, public readonly kind: "configuration" | "unavailable" | "rate_limit" | "invalid_response") {
    super(message);
    this.name = "NvidiaGatewayClientError";
  }
}

/** Default transport: NVIDIA NIM's OpenAI-compatible hosted API. */
const NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

function configuredGatewayUrl() {
  const raw = process.env.NVIDIA_GATEWAY_URL?.trim() || NVIDIA_NIM_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function configuredGatewayToken() {
  const token = process.env.NVIDIA_API_KEY?.trim() || process.env.NOVA_NVIDIA_GATEWAY_TOKEN?.trim();
  return token && token.length >= 32 ? token : undefined;
}

function getMaxRequests() {
  const parsed = Number.parseInt(process.env.NVIDIA_MAX_REQUESTS_PER_WORKSPACE ?? String(DEFAULT_MAX_REQUESTS), 10);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, MAX_CONFIGURED_REQUESTS) : DEFAULT_MAX_REQUESTS;
}

function sanitizeGatewayError(error: unknown) {
  const message = error instanceof Error ? error.message : "NVIDIA inference is temporarily unavailable. Please retry shortly.";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [private credential]").slice(0, ERROR_MESSAGE_LIMIT);
}

function serviceHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function gatewayFetch(path: string, init: RequestInit = {}) {
  const baseUrl = configuredGatewayUrl();
  const token = configuredGatewayToken();
  if (!baseUrl || !token) throw new NvidiaGatewayClientError("NVIDIA inference is not connected yet. An administrator must configure Nova’s server-only gateway connection.", "configuration");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...serviceHeaders(token), ...init.headers },
      signal: controller.signal,
    });
  } catch (error) {
    throw new NvidiaGatewayClientError(sanitizeGatewayError(error), "unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export function isNvidiaGatewayConfigured() {
  return !!(configuredGatewayUrl() && configuredGatewayToken());
}

/** Returns cached or freshly-probed NVIDIA gateway health flags and the user's current allowance. */
export async function getNvidiaGatewayStatus(ownerId: number) {
  const allowance = await getNvidiaInferenceAllowanceForUser(ownerId);
  const maxRequests = getMaxRequests();
  const base = {
    provider: "nvidia-nim" as const,
    model: "nvidia/nemotron-nano-3-30b-a3b",
    allowance: {
      usedRequests: allowance.usedRequests,
      maxRequests,
      remainingRequests: Math.max(0, maxRequests - allowance.usedRequests),
      exhausted: allowance.usedRequests >= maxRequests,
    },
  };
  if (!isNvidiaGatewayConfigured()) {
    return {
      ...base,
      configured: false as const,
      reachable: false as const,
      providerConfigured: false as const,
      providerConfigurationKnown: false as const,
    };
  }
  const cacheKey = `${configuredGatewayUrl()}|${configuredGatewayToken()}`;
  if (
    gatewayHealthCache?.key === cacheKey &&
    gatewayHealthCache.expiresAt > Date.now()
  ) {
    return { ...base, ...gatewayHealthCache.flags };
  }
  try {
    const response = await gatewayFetch("/models");
    // NIM has no dedicated health route: a successful /models round-trip proves
    // both reachability and that the API key is accepted.
    const flags: GatewayHealthFlags = {
      configured: true,
      reachable: response.ok,
      providerConfigured: response.ok,
      providerConfigurationKnown: true,
    };
    gatewayHealthCache = { key: cacheKey, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS, flags };
    return { ...base, ...flags };
  } catch {
    const flags: GatewayHealthFlags = {
      configured: true,
      reachable: false,
      providerConfigured: false,
      providerConfigurationKnown: false,
    };
    gatewayHealthCache = { key: cacheKey, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS, flags };
    return { ...base, ...flags };
  }
}

function modelKind(model: NvidiaModel): "text" | "vision" | undefined {
  const explicitTask = model.task?.toLowerCase().trim();
  if (explicitTask && /embedding|rerank|classification|audio|image-generation|text-to-image|image-embedding|video/i.test(explicitTask)) return undefined;
  const explicitModalities = [...(model.modalities ?? []), ...(model.supported_modalities ?? [])].map(value => value.toLowerCase());
  if (explicitModalities.some(value => /audio|video|image_generation|image-generation|text-to-image/i.test(value))) return undefined;
  if (explicitModalities.length > 0) {
    if (!explicitModalities.some(value => /text/i.test(value))) return undefined;
    return explicitModalities.some(value => /image|vision/i.test(value)) ? "vision" : "text";
  }
  if (explicitTask && /vision|multimodal|visual-language/i.test(explicitTask)) return "vision";
  if (explicitTask && /chat|completion|text|language/i.test(explicitTask)) return "text";
  if (model.capabilities && typeof model.capabilities === "object" && !Array.isArray(model.capabilities)) {
    const keys = Object.keys(model.capabilities).map(key => key.toLowerCase());
    if (keys.some(key => /audio|video|image-generation|text-to-image|embedding|rerank/i.test(key))) return undefined;
    const supportsChat = keys.some(key => /chat|completion|text|language/i.test(key));
    if (!supportsChat) return undefined;
    return keys.some(key => /vision|multimodal|image/i.test(key)) ? "vision" : "text";
  }
  // NVIDIA's OpenAI-compatible /v1/models response normally only includes the
  // model ID and ownership fields. Treat metadata-poor models as text chat models
  // unless their ID identifies a known non-chat model family; otherwise the picker
  // is empty even though the gateway successfully returned available models.
  return /(^|[\/_-])(embed|embedding|rerank|reranker|bge|e5|retriev|asr|speech|tts|audio|flux|stable-diffusion|image-generator|text-to-image|video)([\/_-]|$)/i.test(model.id)
    ? undefined
    : "text";
}

/**
 * Discovers chat-capable NVIDIA text/VLM models from the gateway's OpenAI-compatible
 * /v1/models endpoint. Vision-language models remain eligible because they accept text
 * chat as well as image input. Results are cached briefly for model pickers.
 */
/** Returns the list of available NVIDIA models, cached for five minutes. */
export async function listNvidiaModels(forceRefresh = false) {
  if (!forceRefresh && modelCache && modelCache.expiresAt > Date.now()) return modelCache.models;
  const response = await gatewayFetch("/models");
  const payload = await response.json().catch(() => undefined) as NvidiaModelsResponse | { error?: { message?: string } } | undefined;
  if (!response.ok) {
    const message = payload && "error" in payload ? payload.error?.message : undefined;
    throw new NvidiaGatewayClientError(message ?? "NVIDIA model discovery is temporarily unavailable.", response.status === 429 ? "rate_limit" : "unavailable");
  }
  const rawData = (payload as NvidiaModelsResponse | undefined)?.data;
  const models = Array.isArray(rawData)
    ? rawData
      .filter((model): model is NvidiaModel => typeof model?.id === "string" && model.id.trim().length > 0)
      .map(model => ({ ...model, id: model.id.trim() }))
      .map(model => ({ ...model, kind: modelKind(model) }))
      .filter((model): model is AvailableNvidiaModel => model.kind !== undefined)
    : [];
  if (models.length === 0) {
    throw new NvidiaGatewayClientError("NVIDIA returned no available text or vision-language models.", "invalid_response");
  }
  const deduplicated = Array.from(new Map(models.map(model => [model.id, model])).values())
    .sort((a, b) => a.id.localeCompare(b.id));
  modelCache = { models: deduplicated, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
  return deduplicated;
}

/**
 * Consumes a gateway chat response, emitting deltas through onChunk. If the
 * gateway responds as a real `text/event-stream` it is read incrementally;
 * otherwise the buffered JSON body is emitted once (the gateway may not have
 * streaming support deployed yet).
 */
async function readGatewayStreamedCompletion(
  response: Response,
  onChunk: (chunk: string) => void
): Promise<GatewayCompletion> {
  const isEventStream =
    response.ok &&
    response.body !== null &&
    (response.headers.get("content-type") ?? "").includes("text/event-stream");
  if (isEventStream) {
    let text = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { await reader.cancel().catch(() => {}); return { text }; }
        try {
          const event = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            text += delta;
            onChunk(delta);
          }
        } catch {
          // Ignore malformed stream fragments.
        }
      }
    }
    throw new Error("AI inference stream failed: incomplete response.");
  }
  // Non-streaming completion: read the buffered JSON body and emit it once.
  const payload = await response.json().catch(() => undefined) as
    | GatewayCompletion
    | { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: GatewayCompletion["usage"]; error?: { message?: string } }
    | undefined;
  if (!response.ok) {
    const message = payload && "error" in payload ? payload.error?.message : undefined;
    throw new NvidiaGatewayClientError(message ?? "NVIDIA inference is temporarily unavailable. Please retry shortly.", response.status === 429 ? "rate_limit" : "unavailable");
  }
  const bufferedText = typeof (payload as GatewayCompletion | undefined)?.text === "string"
    ? (payload as GatewayCompletion).text
    : (payload as { choices?: Array<{ message?: { content?: string } }> } | undefined)?.choices?.[0]?.message?.content ?? "";
  if (bufferedText) onChunk(bufferedText);
  const openAiPayload = payload as { model?: string; usage?: GatewayCompletion["usage"] } | undefined;
  return { text: bufferedText, model: openAiPayload?.model, usage: openAiPayload?.usage };
}

export async function completeWithNvidiaGateway(ownerId: number, prompt: string, modelId?: string, onChunk?: (chunk: string) => void) {
  const status = await getNvidiaGatewayStatus(ownerId);
  if (!status.configured || !status.reachable || (status.providerConfigurationKnown && !status.providerConfigured)) {
    throw new NvidiaGatewayClientError("NVIDIA inference is not connected yet. Please try again after the server-only gateway configuration is complete.", "configuration");
  }
  const claim = await claimNvidiaInferenceRequestForUser(ownerId, status.allowance.maxRequests);
  if (!claim) {
    throw new NvidiaGatewayClientError("This workspace has reached Nova’s configured NVIDIA request allowance. New inference requests are blocked until an administrator explicitly raises the cap.", "rate_limit");
  }
  const resolvedModel = modelId?.trim() || status.model;
  const response = await gatewayFetch("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: resolvedModel,
      messages: [{ role: "user", content: prompt }],
      ...(onChunk ? { stream: true } : {}),
    }),
  });
  if (onChunk) {
    const completion = await readGatewayStreamedCompletion(response, onChunk);
    const text = typeof completion.text === "string" ? completion.text : "";
    if (!text) {
      throw new NvidiaGatewayClientError("NVIDIA returned an invalid completion. Please retry shortly.", "invalid_response");
    }
    return {
      text,
      model: completion.model ?? resolvedModel,
      usage: completion.usage ?? null,
      allowance: {
        usedRequests: claim.usedRequests,
        maxRequests: status.allowance.maxRequests,
        remainingRequests: Math.max(0, status.allowance.maxRequests - claim.usedRequests),
        exhausted: claim.usedRequests >= status.allowance.maxRequests,
      },
    };
  }
  const payload = await response.json().catch(() => undefined) as
    | GatewayCompletion
    | { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: GatewayCompletion["usage"]; error?: { message?: string } }
    | undefined;
  if (!response.ok) {
    const message = payload && "error" in payload ? payload.error?.message : undefined;
    throw new NvidiaGatewayClientError(message ?? "NVIDIA inference is temporarily unavailable. Please retry shortly.", response.status === 429 ? "rate_limit" : "unavailable");
  }
  const bufferedText = typeof (payload as GatewayCompletion | undefined)?.text === "string"
    ? (payload as GatewayCompletion).text
    : (payload as { choices?: Array<{ message?: { content?: string } }> } | undefined)?.choices?.[0]?.message?.content ?? "";
  if (!bufferedText) {
    throw new NvidiaGatewayClientError("NVIDIA returned an invalid completion. Please retry shortly.", "invalid_response");
  }
  const completion = payload as { model?: string; usage?: GatewayCompletion["usage"] } | undefined;
  return {
    text: bufferedText,
    model: completion?.model ?? resolvedModel,
    usage: completion?.usage ?? null,
    allowance: {
      usedRequests: claim.usedRequests,
      maxRequests: status.allowance.maxRequests,
      remainingRequests: Math.max(0, status.allowance.maxRequests - claim.usedRequests),
      exhausted: claim.usedRequests >= status.allowance.maxRequests,
    },
  };
}
