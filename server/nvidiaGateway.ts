import { claimNvidiaInferenceRequestForUser, getNvidiaInferenceAllowanceForUser } from "./db";

const DEFAULT_MAX_REQUESTS = 50;
const MAX_CONFIGURED_REQUESTS = 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const ERROR_MESSAGE_LIMIT = 600;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

type GatewayHealth = {
  status?: string;
  provider?: string;
  providerConfigured?: boolean;
};

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
};

type NvidiaModelsResponse = {
  data?: NvidiaModel[];
};

let modelCache: { models: NvidiaModel[]; expiresAt: number } | undefined;

export class NvidiaGatewayClientError extends Error {
  constructor(message: string, public readonly kind: "configuration" | "unavailable" | "rate_limit" | "invalid_response") {
    super(message);
    this.name = "NvidiaGatewayClientError";
  }
}

function configuredGatewayUrl() {
  const raw = process.env.NVIDIA_GATEWAY_URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function configuredGatewayToken() {
  const token = process.env.NOVA_NVIDIA_GATEWAY_TOKEN?.trim();
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
  return Boolean(configuredGatewayUrl() && configuredGatewayToken());
}

export async function getNvidiaGatewayStatus(ownerId: number) {
  const allowance = await getNvidiaInferenceAllowanceForUser(ownerId);
  const maxRequests = getMaxRequests();
  const base = {
    provider: "nvidia-nim" as const,
    model: "nvidia/nemotron-3-nano-30b-a3b",
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
  try {
    const response = await gatewayFetch("/api/nvidia/health");
    const rawHealth = await response.text().catch(() => "");
    let health: GatewayHealth | undefined;
    if (rawHealth) {
      try {
        health = JSON.parse(rawHealth) as GatewayHealth;
      } catch {
        health = undefined;
      }
    }
    const providerConfigurationKnown = health?.status === "ok" && typeof health.providerConfigured === "boolean";
    return {
      ...base,
      configured: true as const,
      reachable: response.ok,
      providerConfigured: Boolean(health?.providerConfigured),
      providerConfigurationKnown,
    };
  } catch {
    return {
      ...base,
      configured: true as const,
      reachable: false as const,
      providerConfigured: false as const,
      providerConfigurationKnown: false as const,
    };
  }
}

/**
 * Discovers the models currently exposed by the NVIDIA gateway's OpenAI-compatible
 * /v1/models endpoint. Results are cached briefly so model pickers do not hit the
 * upstream provider on every render/message.
 */
export async function listNvidiaModels(forceRefresh = false) {
  if (!forceRefresh && modelCache && modelCache.expiresAt > Date.now()) return modelCache.models;
  const response = await gatewayFetch("/v1/models");
  const payload = await response.json().catch(() => undefined) as NvidiaModelsResponse | { error?: { message?: string } } | undefined;
  if (!response.ok) {
    const message = payload && "error" in payload ? payload.error?.message : undefined;
    throw new NvidiaGatewayClientError(message ?? "NVIDIA model discovery is temporarily unavailable.", response.status === 429 ? "rate_limit" : "unavailable");
  }
  const models = Array.isArray((payload as NvidiaModelsResponse | undefined)?.data)
    ? (payload as NvidiaModelsResponse).data
      .filter((model): model is NvidiaModel => typeof model?.id === "string" && model.id.trim().length > 0)
      .map(model => ({ ...model, id: model.id.trim() }))
    : [];
  if (models.length === 0) {
    throw new NvidiaGatewayClientError("NVIDIA returned no available models.", "invalid_response");
  }
  const deduplicated = Array.from(new Map(models.map(model => [model.id, model])).values())
    .sort((a, b) => a.id.localeCompare(b.id));
  modelCache = { models: deduplicated, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
  return deduplicated;
}

export async function completeWithNvidiaGateway(ownerId: number, prompt: string, modelId?: string) {
  const status = await getNvidiaGatewayStatus(ownerId);
  if (!status.configured || !status.reachable || (status.providerConfigurationKnown && !status.providerConfigured)) {
    throw new NvidiaGatewayClientError("NVIDIA inference is not connected yet. Please try again after the server-only gateway configuration is complete.", "configuration");
  }
  const claim = await claimNvidiaInferenceRequestForUser(ownerId, status.allowance.maxRequests);
  if (!claim) {
    throw new NvidiaGatewayClientError("This workspace has reached Nova’s configured NVIDIA request allowance. New inference requests are blocked until an administrator explicitly raises the cap.", "rate_limit");
  }
  const response = await gatewayFetch("/api/nvidia/chat", {
    method: "POST",
    body: JSON.stringify({ prompt, ...(modelId?.trim() ? { model: modelId.trim() } : {}) }),
  });
  const payload = await response.json().catch(() => undefined) as GatewayCompletion | { error?: { message?: string } } | undefined;
  if (!response.ok) {
    const message = payload && "error" in payload ? payload.error?.message : undefined;
    throw new NvidiaGatewayClientError(message ?? "NVIDIA inference is temporarily unavailable. Please retry shortly.", response.status === 429 ? "rate_limit" : "unavailable");
  }
  const completion = payload as GatewayCompletion | undefined;
  if (!completion?.text || typeof completion.text !== "string") {
    throw new NvidiaGatewayClientError("NVIDIA returned an invalid completion. Please retry shortly.", "invalid_response");
  }
  return {
    text: completion.text,
    model: completion.model ?? modelId ?? status.model,
    usage: completion.usage ?? null,
    allowance: {
      usedRequests: claim.usedRequests,
      maxRequests: status.allowance.maxRequests,
      remainingRequests: Math.max(0, status.allowance.maxRequests - claim.usedRequests),
      exhausted: claim.usedRequests >= status.allowance.maxRequests,
    },
  };
}
