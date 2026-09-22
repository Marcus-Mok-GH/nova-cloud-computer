import {
  claimMistralInferenceRequestForUser,
  getMistralInferenceAllowanceForUser,
} from "./db";

const MAX_CONFIGURED_REQUESTS = 1000;
const REQUEST_TIMEOUT_MS = 25_000;
// Chat completions carry the whole conversation plus tool results, so the
// model can take far longer than a metadata /models lookup to produce its
// first byte. Give them a much more patient timeout or long tool-calling
// rounds get aborted mid-generation and surface as gateway failures.
const CHAT_REQUEST_TIMEOUT_MS = 120_000;
// A stream that delivers nothing for this long is treated as dead instead of
// hanging the agent loop (and the Telegram webhook behind it) indefinitely.
const STREAM_STALL_TIMEOUT_MS = 120_000;
const ERROR_MESSAGE_LIMIT = 600;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const HEALTH_CACHE_TTL_MS = 10_000;

export type GatewayCompletion = {
  text?: string;
  model?: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

type MistralModel = {
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

type MistralModelsResponse = {
  data?: MistralModel[];
};

export type AvailableMistralModel = MistralModel & {
  /** Models in the picker always support chat; vision models also accept image input. */
  kind: "text" | "vision";
};

let modelCache:
  { models: AvailableMistralModel[]; expiresAt: number } | undefined;

type GatewayHealthFlags = {
  configured: boolean;
  reachable: boolean;
  providerConfigured: boolean;
  providerConfigurationKnown: boolean;
};

let gatewayHealthCache:
  { key: string; expiresAt: number; flags: GatewayHealthFlags } | undefined;

/** Clears the in-process gateway health cache (used by tests between cases). */
export function resetMistralGatewayHealthCache() {
  gatewayHealthCache = undefined;
}

export type MistralGatewayClientErrorKind =
  | "configuration"
  | "unavailable"
  | "rate_limit"
  | "allowance_reached"
  | "invalid_response"
  | "client_error"
  | "stopped";

/**
 * Maps an upstream HTTP status to the gateway error kind. 429 keeps its special
 * rate-limit handling and 401/403 mean the configured credential is wrong, but
 * other 4xx statuses (except the transient 408/425) are permanent request
 * problems - a bad model id or an oversized prompt - that retrying cannot fix,
 * so the workspace agent must not burn its retry budget on them.
 */
export function classifyGatewayHttpError(status: number): MistralGatewayClientErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "configuration";
  if (status >= 400 && status < 500 && status !== 408 && status !== 425)
    return "client_error";
  return "unavailable";
}

export class MistralGatewayClientError extends Error {
  constructor(
    message: string,
    public readonly kind: MistralGatewayClientErrorKind
  ) {
    super(message);
    this.name = "MistralGatewayClientError";
  }
}

/** Default transport: Mistral AI's OpenAI-compatible hosted API. */
const MISTRAL_API_BASE_URL = "https://api.mistral.ai/v1";

/** Default transport for the Z.ai (Zhipu GLM) gateway. */
const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";

/**
 * The gateway serves either Mistral or Z.ai (Zhipu GLM). Mode is chosen by
 * which credential is configured: a ZAI_API_KEY switches the gateway to Z.ai,
 * including its env var names (ZAI_GATEWAY_URL, ZAI_DEFAULT_MODEL,
 * ZAI_FALLBACK_MODEL) and default base URL; without it the legacy Mistral
 * configuration (MISTRAL_API_KEY / NOVA_MISTRAL_GATEWAY_TOKEN,
 * MISTRAL_GATEWAY_URL, MISTRAL_DEFAULT_MODEL, MISTRAL_FALLBACK_MODEL) keeps
 * working unchanged. Reading the credential and its companion vars from the
 * same mode keeps the switch atomic: a deployment that sets ZAI_API_KEY but
 * has not yet set ZAI_GATEWAY_URL falls back to Z.ai's own base URL, never to
 * a Mistral URL paired with a Z.ai credential.
 */
function zaiGatewayToken() {
  const token =
    process.env.ZAI_API_KEY?.trim() ||
    process.env.NOVA_ZAI_GATEWAY_TOKEN?.trim();
  return token && token.length >= 32 ? token : undefined;
}

function mistralGatewayToken() {
  const token =
    process.env.MISTRAL_API_KEY?.trim() ||
    process.env.NOVA_MISTRAL_GATEWAY_TOKEN?.trim();
  return token && token.length >= 32 ? token : undefined;
}

function configuredGatewayUrl() {
  const zai = !!zaiGatewayToken();
  const raw = zai
    ? process.env.ZAI_GATEWAY_URL?.trim() || ZAI_API_BASE_URL
    : process.env.MISTRAL_GATEWAY_URL?.trim() || MISTRAL_API_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function configuredGatewayToken() {
  return zaiGatewayToken() ?? mistralGatewayToken();
}

/**
 * Best-effort upstream error text from an OpenAI-compatible error payload.
 * Multi-gateway relays (like the Kilo AI gateway) wrap the provider's real
 * error in error.metadata.raw behind a generic message ("Provider returned
 * error"), so prefer the raw text when it is present.
 */
function gatewayErrorMessageFromPayload(
  payload: unknown
): string | undefined {
  const error = (payload as { error?: unknown } | undefined)?.error;
  if (typeof error === "string") return error.slice(0, ERROR_MESSAGE_LIMIT);
  const record = error as
    | { message?: unknown; metadata?: { raw?: unknown } }
    | undefined;
  const raw = typeof record?.metadata?.raw === "string" ? record.metadata.raw : undefined;
  const message = typeof record?.message === "string" ? record.message : undefined;
  return (raw ?? message)?.slice(0, ERROR_MESSAGE_LIMIT) || undefined;
}

/** Best-effort human-readable description of a failed Mistral HTTP response. */
function describeMistralError(
  payload: unknown,
  status: number
): string | undefined {
  const record = payload as
    | {
        error?: { message?: string } | string;
        message?: string;
        detail?: unknown;
        title?: string;
      }
    | undefined;
  const parts: string[] = [];
  const raw = record?.error
    ? typeof record.error === "string"
      ? record.error
      : record.error.message
    : undefined;
  const detail =
    typeof record?.detail === "string"
      ? record.detail
      : record?.detail !== undefined
        ? JSON.stringify(record.detail)
        : undefined;
  const message = raw ?? record?.message ?? detail ?? record?.title;
  if (message) parts.push(String(message).slice(0, 300));
  parts.push(`HTTP ${status}`);
  return `Mistral request failed (${parts.join(" · ")})`;
}

/**
 * Daily Mistral inference request cap per workspace. Returns null (no cap) unless
 * MISTRAL_MAX_REQUESTS_PER_WORKSPACE is set to a positive integer; "0", "none",
 * "unlimited", or an unset/invalid value all mean unlimited.
 */
function getMaxRequests(): number | null {
  const raw =
    process.env.MISTRAL_MAX_REQUESTS_PER_WORKSPACE?.trim().toLowerCase();
  if (!raw || raw === "0" || raw === "none" || raw === "unlimited") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1
    ? Math.min(parsed, MAX_CONFIGURED_REQUESTS)
    : null;
}

export function sanitizeGatewayError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Nova’s AI service is temporarily unavailable. Please retry shortly.";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [private credential]")
    .slice(0, ERROR_MESSAGE_LIMIT);
}

function serviceHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function gatewayFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  externalSignal?: AbortSignal,
  target?: { baseUrl: string; token?: string }
) {
  // The primary gateway target is resolved lazily so a call with an explicit
  // anonymous target (the Kilo tier) never requires a configured credential.
  const resolvedTarget = target ?? {
    baseUrl: configuredGatewayUrl(),
    token: configuredGatewayToken(),
  };
  if (!resolvedTarget.baseUrl || (!target && !resolvedTarget.token))
    throw new MistralGatewayClientError(
      "Nova’s AI service is not connected yet. An administrator must configure the server-only gateway connection.",
      "configuration"
    );
  const controller = new AbortController();
  // A user's /stop aborts the in-flight request just like the timeout does.
  const abortWithStop = () => controller.abort();
  externalSignal?.addEventListener("abort", abortWithStop, { once: true });
  if (externalSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${resolvedTarget.baseUrl}${path}`, {
      ...init,
      // Anonymous targets carry no token: the gateway serves their free
      // models without credentials, and a bogus Authorization header would
      // be rejected outright.
      headers: {
        ...(resolvedTarget.token
          ? { Authorization: `Bearer ${resolvedTarget.token}` }
          : {}),
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new MistralGatewayClientError(
      externalSignal?.aborted
        ? "This reply was stopped with /stop."
        : sanitizeGatewayError(error),
      "stopped"
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortWithStop);
  }
}

export function isMistralGatewayConfigured() {
  return !!(configuredGatewayUrl() && configuredGatewayToken());
}

/** Returns cached or freshly-probed Mistral gateway health flags and the user's current allowance. */
export async function getMistralGatewayStatus(ownerId: number) {
  const allowance = await getMistralInferenceAllowanceForUser(ownerId);
  const maxRequests = getMaxRequests();
  const base = {
    provider: "mistral" as const,
    model: configuredDefaultChatModel(),
    allowance: {
      usedRequests: allowance.usedRequests,
      maxRequests,
      remainingRequests:
        maxRequests === null
          ? null
          : Math.max(0, maxRequests - allowance.usedRequests),
      exhausted: maxRequests !== null && allowance.usedRequests >= maxRequests,
    },
  };
  if (!isMistralGatewayConfigured()) {
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
    return { ...base, model: defaultMistralModel(), ...gatewayHealthCache.flags };
  }
  try {
    const response = await gatewayFetch("/models");
    // Mistral has no dedicated health route: a successful /models round-trip proves
    // both reachability and that the API key is accepted.
    const flags: GatewayHealthFlags = {
      configured: true,
      reachable: response.ok,
      providerConfigured: response.ok,
      providerConfigurationKnown: true,
    };
    gatewayHealthCache = {
      key: cacheKey,
      expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
      flags,
    };
    // Reuse the same /models round-trip to prime model discovery: the default
    // chat model prefers a vision-capable entry so uploaded images reach the
    // model directly instead of hitting the no-vision fallback.
    if (response.ok) {
      const payload = (await response.json().catch(() => undefined)) as
        | MistralModelsResponse
        | undefined;
      const models = parseMistralModels(payload);
      if (models.length > 0) cacheMistralModels(models);
    }
    return { ...base, model: defaultMistralModel(), ...flags };
  } catch {
    const flags: GatewayHealthFlags = {
      configured: true,
      reachable: false,
      providerConfigured: false,
      providerConfigurationKnown: false,
    };
    gatewayHealthCache = {
      key: cacheKey,
      expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
      flags,
    };
    return { ...base, model: defaultMistralModel(), ...flags };
  }
}

function modelKind(model: MistralModel): "text" | "vision" | undefined {
  const explicitTask = model.task?.toLowerCase().trim();
  if (
    explicitTask &&
    /embedding|rerank|classification|audio|image-generation|text-to-image|image-embedding|video/i.test(
      explicitTask
    )
  )
    return undefined;
  const explicitModalities = [
    ...(model.modalities ?? []),
    ...(model.supported_modalities ?? []),
  ].map(value => value.toLowerCase());
  if (explicitModalities.length > 0) {
    // Only models that cannot chat in text are rejected. Omni models that
    // understand audio or video alongside text and images stay eligible.
    if (!explicitModalities.some(value => value === "text")) return undefined;
    return explicitModalities.some(
      value => value === "image" || value === "image_in"
    )
      ? "vision"
      : "text";
  }
  if (explicitTask && /vision|multimodal|visual-language/i.test(explicitTask))
    return "vision";
  if (explicitTask && /chat|completion|text|language/i.test(explicitTask))
    return "text";
  if (
    model.capabilities &&
    typeof model.capabilities === "object" &&
    !Array.isArray(model.capabilities)
  ) {
    const keys = Object.keys(model.capabilities).map(key => key.toLowerCase());
    if (
      keys.some(key =>
        /audio|video|image-generation|text-to-image|embedding|rerank/i.test(key)
      )
    )
      return undefined;
    const supportsChat = keys.some(key =>
      /chat|completion|text|language/i.test(key)
    );
    if (!supportsChat) return undefined;
    return keys.some(key => /vision|multimodal|image/i.test(key))
      ? "vision"
      : "text";
  }
  // Mistral's OpenAI-compatible /v1/models response normally only includes the
  // model ID and ownership fields. Treat metadata-poor models as text chat models
  // unless their ID identifies a known non-chat model family; otherwise the picker
  // is empty even though the gateway successfully returned available models.
  if (/(^|[\/_-])(embed|embedding|rerank|reranker|bge|e5|retriev|asr|speech|tts|audio|voxtral|ocr|flux|stable-diffusion|image-generator|text-to-image|video)([\/_-]|$)/i.test(model.id))
    return undefined;
  return /(^|[\/_-])(vision|vlm|multimodal|visual-language|omni|pixtral)([\/_-]|$)/i.test(
    model.id
  )
    ? "vision"
    : "text";
}

/**
 * Default chat model: ministral-14b - the strongest model the free-tier
 * Mistral subscription serves (verified 2026-09-18: medium/small/magistral
 * families are all paid-tier-only and return misleading 429s on free keys).
 * Text-only with function/tool calling and a 128K-token context, served
 * over the OpenAI-compatible chat API.
 */
export const DEFAULT_MISTRAL_MODEL = "ministral-14b-latest";

/**
 * Text-only fallback if model discovery proves the default is not served here.
 * ministral-8b is the next-strongest free-tier-served text model.
 */
export const TEXT_FALLBACK_MODEL = "ministral-8b-latest";

/**
 * Free-tier text fallback for Z.ai deployments: like the default model, the
 * free flash models are served but unlisted by /models, so the Mistral
 * fallback id would never resolve there.
 */
export const ZAI_TEXT_FALLBACK_MODEL = "glm-4.5-flash";

/**
 * Default model for chat turns that carry image attachments: Z.ai's free
 * vision model. Its /models endpoint omits the free flash models, so (like
 * the text fallback) the id is hardcoded rather than discovered.
 */
export const ZAI_VISION_FALLBACK_MODEL = "glm-4.6v-flash";

/**
 * Free-tier last resort for Z.ai deployments: when the default AND the
 * text-fallback pools are both congested, the chain tries the remaining
 * free model. It only serves a vision-capable flash model, which also
 * accepts text-only turns, so the id matches the vision default. Like the
 * other free flash models it is served but unlisted by /models.
 */
export const ZAI_LAST_RESORT_MODEL_ID = "glm-4.6v-flash";

/**
 * Operator override for the default chat model id. The hardcoded default is
 * Mistral-specific, but the gateway can serve any OpenAI-compatible provider
 * (e.g. Z.ai's GLM API via ZAI_GATEWAY_URL). This override lets the
 * deployment point the default at the provider's own model id - for example
 * ZAI_DEFAULT_MODEL=glm-4.7-flash - without a code change. The override
 * is only authoritative when the gateway actually serves that model id;
 * otherwise discovery degrades exactly as it does for the hardcoded default.
 */
export function configuredDefaultChatModel(): string {
  const override = zaiGatewayToken()
    ? process.env.ZAI_DEFAULT_MODEL?.trim()
    : process.env.MISTRAL_DEFAULT_MODEL?.trim();
  return override || DEFAULT_MISTRAL_MODEL;
}

/**
 * Operator override for the vision model id used on chat turns with image
 * attachments. Returns undefined in Mistral mode so model resolution keeps
 * its discovery-based vision preference there; in Z.ai mode the override (or
 * the hardcoded free vision model) is authoritative, mirroring the
 * configured-default behaviour.
 */
export function configuredVisionChatModel(): string | undefined {
  if (!zaiGatewayToken()) return undefined;
  return process.env.ZAI_VISION_MODEL?.trim() || ZAI_VISION_FALLBACK_MODEL;
}

/**
 * Operator override for the text fallback model id, mirroring
 * configuredDefaultChatModel for deployments on a non-Mistral provider.
 */
export function configuredTextFallbackModel(): string {
  const override = zaiGatewayToken()
    ? process.env.ZAI_FALLBACK_MODEL?.trim()
    : process.env.MISTRAL_FALLBACK_MODEL?.trim();
  if (override) return override;
  // Z.ai's /models endpoint omits the free flash models, so the hardcoded
  // Mistral fallback id cannot resolve there; the other free flash model is
  // the verified-served Z.ai default (used for pool-overload degradation).
  return zaiGatewayToken() ? ZAI_TEXT_FALLBACK_MODEL : TEXT_FALLBACK_MODEL;
}

/**
 * Third and final pool-overload tier for Z.ai deployments: when the default
 * and fallback pools are both congested, requests retry on this model.
 * Returns undefined in Mistral mode so the two-tier chain (default, then
 * configured text fallback) keeps its existing behaviour there.
 */
export function configuredLastResortModel(): string | undefined {
  if (!zaiGatewayToken()) return undefined;
  return process.env.ZAI_LAST_RESORT_MODEL?.trim() || ZAI_LAST_RESORT_MODEL_ID;
}

/**
 * Zero-key last-resort tier for Z.ai deployments: when the whole Z.ai chain
 * (default, text fallback, last resort) is congested, the request is retried
 * anonymously on the Kilo AI gateway, whose OpenAI-compatible endpoint serves
 * ":free" models without any credential (200 requests/hour per IP upstream).
 * The hop models were live-probed for tool calling, clean streamed output,
 * and low congestion: cohere/north-mini-code (fast agentic coder, ~0.7s) is
 * the text hop and inclusionai/ling-3.0-flash-vl (vision-capable, steady
 * availability) is the floor. The vision hop also serves text-only turns, so
 * it doubles as the text chain's second attempt; image turns skip the text
 * hop entirely because a text-only model would reject the image input and
 * abort the attempt. Anonymous tier only: this never uses a Kilo credential,
 * so it cannot regress to a billed path.
 */
export const KILO_API_BASE_URL = "https://api.kilo.ai/api/gateway";
export const KILO_ANONYMOUS_MODEL_ID = "cohere/north-mini-code:free";
export const KILO_ANONYMOUS_VISION_MODEL_ID = "inclusionai/ling-3.0-flash-vl:free";

/**
 * Operator override for the Kilo gateway base URL, mirroring the primary
 * gateway's https-only validation. An invalid value silently disables the
 * anonymous tier (the chain keeps its pre-Kilo behaviour) rather than
 * breaking the configured primary path.
 */
function configuredKiloGatewayUrl() {
  const raw = process.env.KILO_GATEWAY_URL?.trim() || KILO_API_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/** One hop id from an env override; "off"/"none"/"" removes the hop. */
function kiloHopModel(
  override: string | undefined,
  fallback: string
): string | undefined {
  const value = override?.trim();
  if (value === undefined) return fallback;
  if (!value || value.toLowerCase() === "off" || value.toLowerCase() === "none")
    return undefined;
  return value;
}

/**
 * Ordered Kilo anonymous hop ids for one chat turn. Vision turns (resolved
 * to the vision model) only try the vision-capable hop; text turns try the
 * coding hop first and the vision hop as the floor. Returns an empty list
 * when every hop is disabled via env override.
 */
export function configuredKiloAnonymousHopModels(resolvedModel: string): string[] {
  const text = kiloHopModel(
    process.env.KILO_ANONYMOUS_MODEL,
    KILO_ANONYMOUS_MODEL_ID
  );
  const vision = kiloHopModel(
    process.env.KILO_ANONYMOUS_VISION_MODEL,
    KILO_ANONYMOUS_VISION_MODEL_ID
  );
  const visionTurn =
    !!resolvedModel && resolvedModel === configuredVisionChatModel();
  const hops = visionTurn ? [vision] : [text, vision];
  return Array.from(new Set(hops.filter((model): model is string => !!model)));
}

/**
 * The anonymous Kilo target, or undefined when the deployment is not in Z.ai
 * mode or the gateway URL is misconfigured. Carries no token on purpose: the
 * free models are served without credentials.
 */
function kiloGatewayTarget(): { baseUrl: string; token?: string } | undefined {
  const baseUrl = configuredKiloGatewayUrl();
  return baseUrl ? { baseUrl } : undefined;
}

/**
 * Pool-overload degradation window: after the resolved chat model fails with
 * an upstream overload (HTTP 429 - z.ai error 1305 free-pool congestion),
 * later requests skip straight to the pool-fallback model until this many
 * milliseconds pass.
 */
const POOL_DEGRADE_MS = 5 * 60_000;
/** Timestamp (epoch ms) until which the resolved chat model stays degraded. */
let poolDegradedUntil = 0;
/** Test hook: clear pool-overload degradation between suites. */
export function resetMistralPoolDegradation() {
  poolDegradedUntil = 0;
}

/** Test hook: drop the discovered-model cache between suites. */
export function resetMistralModelCache() {
  modelCache = undefined;
}

/**
 * The default chat model, preferring a vision-capable one so uploaded images
 * reach the model directly. Falls back to the text default until discovery
 * finds a vision model.
 */
export function defaultMistralModel(): string {
  const defaultModel = configuredDefaultChatModel();
  const textFallbackModel = configuredTextFallbackModel();
  // Z.ai serves free flash models that its /models endpoint does not list, so
  // a configured Z.ai override is authoritative without the served-check
  // below - discovery would otherwise degrade a deliberate glm-4.7-flash
  // default to the first listed (paid) model and trip the account balance
  // wall. The Mistral side keeps the served-check: its /models list is
  // authoritative.
  if (defaultModel !== DEFAULT_MISTRAL_MODEL && zaiGatewayToken())
    return defaultModel;
  if (!modelCache || modelCache.expiresAt <= Date.now()) return defaultModel;
  // The configured default is authoritative whenever this gateway serves it.
  if (modelCache.models.some(model => model.id === defaultModel))
    return defaultModel;
  // This gateway does not serve the default: degrade to another vision model
  // (preferring the current medium family over the deprecated pixtral one),
  // then to a discovered text model. The configured text fallback is only
  // authoritative when this gateway actually serves it.
  const vision = modelCache.models.filter(model => model.kind === "vision");
  const visionPick =
    vision.find(model => model.id.includes("medium"))?.id ??
    vision.find(model => model.id.includes("pixtral"))?.id ??
    vision[0]?.id;
  if (visionPick) return visionPick;
  return (
    modelCache.models.find(model => model.id === textFallbackModel)?.id ??
    modelCache.models.find(model => model.kind === "text")?.id ??
    textFallbackModel
  );
}

function parseMistralModels(payload: MistralModelsResponse | undefined): AvailableMistralModel[] {
  const rawData = payload?.data;
  if (!Array.isArray(rawData)) return [];
  return rawData
    .filter(
      (model): model is MistralModel =>
        typeof model?.id === "string" && model.id.trim().length > 0
    )
    .map(model => ({ ...model, id: model.id.trim() }))
    .map(model => ({ ...model, kind: modelKind(model) }))
    .filter(
      (model): model is AvailableMistralModel => model.kind !== undefined
    );
}

function cacheMistralModels(models: AvailableMistralModel[]) {
  const deduplicated = Array.from(
    new Map(models.map(model => [model.id, model])).values()
  ).sort((a, b) => a.id.localeCompare(b.id));
  modelCache = {
    models: deduplicated,
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
  };
  return deduplicated;
}

/**
 * Discovers chat-capable Mistral text/VLM models from the gateway's OpenAI-compatible
 * /v1/models endpoint. Vision-language models remain eligible because they accept text
 * chat as well as image input. Results are cached briefly for model pickers.
 */
/** Returns the list of available Mistral models, cached for five minutes. */
export async function listMistralModels(forceRefresh = false) {
  if (!forceRefresh && modelCache && modelCache.expiresAt > Date.now())
    return modelCache.models;
  const response = await gatewayFetch("/models");
  const payload = (await response.json().catch(() => undefined)) as
    MistralModelsResponse | { error?: { message?: string } } | undefined;
  if (!response.ok) {
    const message =
      payload && "error" in payload ? payload.error?.message : undefined;
    throw new MistralGatewayClientError(
      message ??
        describeMistralError(payload, response.status) ??
        "AI model discovery is temporarily unavailable.",
      classifyGatewayHttpError(response.status)
    );
  }
  const models = parseMistralModels(payload as MistralModelsResponse | undefined);
  if (models.length === 0) {
    throw new MistralGatewayClientError(
      "The AI service returned no available chat models.",
      "invalid_response"
    );
  }
  return cacheMistralModels(models);
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
        if (data === "[DONE]") {
          await reader.cancel().catch(() => {});
          return { text };
        }
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
  const payload = (await response.json().catch(() => undefined)) as
    | GatewayCompletion
    | {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: GatewayCompletion["usage"];
        error?: { message?: string };
      }
    | undefined;
  if (!response.ok) {
    const message = gatewayErrorMessageFromPayload(payload);
    throw new MistralGatewayClientError(
      message ??
        describeMistralError(payload, response.status) ??
        "Nova’s AI service is temporarily unavailable. Please retry shortly.",
      classifyGatewayHttpError(response.status)
    );
  }
  const bufferedText =
    typeof (payload as GatewayCompletion | undefined)?.text === "string"
      ? (payload as GatewayCompletion).text
      : ((
          payload as
            { choices?: Array<{ message?: { content?: string } }> } | undefined
        )?.choices?.[0]?.message?.content ?? "");
  if (bufferedText) onChunk(bufferedText);
  const openAiPayload = payload as
    { model?: string; usage?: GatewayCompletion["usage"] } | undefined;
  return {
    text: bufferedText,
    model: openAiPayload?.model,
    usage: openAiPayload?.usage,
  };
}

export async function completeWithMistralGateway(
  ownerId: number,
  prompt: string,
  modelId?: string,
  onChunk?: (chunk: string) => void
) {
  const status = await getMistralGatewayStatus(ownerId);
  if (
    !status.configured ||
    !status.reachable ||
    (status.providerConfigurationKnown && !status.providerConfigured)
  ) {
    throw new MistralGatewayClientError(
      "Nova’s AI service is not connected yet. Please try again after the gateway configuration is complete.",
      "configuration"
    );
  }
  const claim = await claimMistralInferenceRequestForUser(
    ownerId,
    status.allowance.maxRequests
  );
  if (!claim) {
    throw new MistralGatewayClientError(
      "This workspace has reached Nova’s configured AI request allowance. New inference requests are blocked until an administrator explicitly raises the cap.",
      "allowance_reached"
    );
  }
  const resolvedModel = modelId?.trim() || status.model;
  const postPromptCompletion = async (
    model: string,
    target?: { baseUrl: string; token?: string }
  ) => {
  const response = await gatewayFetch("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      ...(onChunk ? { stream: true } : {}),
    }),
  }, REQUEST_TIMEOUT_MS, undefined, target);
  if (onChunk) {
    const completion = await readGatewayStreamedCompletion(response, onChunk);
    const text = typeof completion.text === "string" ? completion.text : "";
    if (!text) {
      throw new MistralGatewayClientError(
        "The AI service returned an invalid completion. Please retry shortly.",
        "invalid_response"
      );
    }
    return {
      text,
      model: completion.model ?? model,
      usage: completion.usage ?? null,
      allowance: {
        usedRequests: claim.usedRequests,
        maxRequests: status.allowance.maxRequests,
        remainingRequests:
          status.allowance.maxRequests === null
            ? null
            : Math.max(0, status.allowance.maxRequests - claim.usedRequests),
        exhausted:
          status.allowance.maxRequests !== null &&
          claim.usedRequests >= status.allowance.maxRequests,
      },
    };
  }
  const payload = (await response.json().catch(() => undefined)) as
    | GatewayCompletion
    | {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: GatewayCompletion["usage"];
        error?: { message?: string };
      }
    | undefined;
  if (!response.ok) {
    const message = gatewayErrorMessageFromPayload(payload);
    throw new MistralGatewayClientError(
      message ??
        describeMistralError(payload, response.status) ??
        "Nova’s AI service is temporarily unavailable. Please retry shortly.",
      classifyGatewayHttpError(response.status)
    );
  }
  const bufferedText =
    typeof (payload as GatewayCompletion | undefined)?.text === "string"
      ? (payload as GatewayCompletion).text
      : ((
          payload as
            { choices?: Array<{ message?: { content?: string } }> } | undefined
        )?.choices?.[0]?.message?.content ?? "");
  if (!bufferedText) {
    throw new MistralGatewayClientError(
      "The AI service returned an invalid completion. Please retry shortly.",
      "invalid_response"
    );
  }
  const completion = payload as
    { model?: string; usage?: GatewayCompletion["usage"] } | undefined;
  return {
    text: bufferedText,
    model: completion?.model ?? model,
    usage: completion?.usage ?? null,
    allowance: {
      usedRequests: claim.usedRequests,
      maxRequests: status.allowance.maxRequests,
      remainingRequests:
        status.allowance.maxRequests === null
          ? null
          : Math.max(0, status.allowance.maxRequests - claim.usedRequests),
      exhausted:
        status.allowance.maxRequests !== null &&
        claim.usedRequests >= status.allowance.maxRequests,
    },
  };
  };
  const kiloTarget = zaiGatewayToken() ? kiloGatewayTarget() : undefined;
  return attemptWithPoolFallback(
    status,
    claim,
    resolvedModel,
    model => postPromptCompletion(model),
    kiloTarget ? model => postPromptCompletion(model, kiloTarget) : undefined
  );
}

export type GatewayToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type GatewayToolCall = {
  id: string;
  name: string;
  /** Raw JSON-encoded arguments string, exactly as returned by the model. */
  arguments: string;
};

export type GatewayChatMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type GatewayChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  /** Plain text, or content parts for multimodal turns (e.g. attached images). */
  content?: string | null | GatewayChatMessageContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type GatewayChatResult = {
  text: string;
  toolCalls: GatewayToolCall[];
  model: string;
  usage: GatewayCompletion["usage"] | null;
  allowance: {
    usedRequests: number;
    maxRequests: number | null;
    remainingRequests: number | null;
    exhausted: boolean;
  };
};

/**
 * Single OpenAI-compatible chat completion with optional function-calling
 * tools. Tool-call rounds are buffered so the caller can execute tools and
 * re-invoke; pass `onChunk` to stream text deltas as they arrive. Claims one
 * inference request per call.
 */
type StreamedGatewayChat = {
  text: string;
  toolCalls: GatewayToolCall[];
  model: string | null;
  usage: GatewayCompletion["usage"] | null;
  /** Upstream error text relayed inside the stream, when present. */
  error: string | null;
  /** finish_reason of the final choice, when the gateway sends one. */
  finishReason: string | null;
  /** Number of SSE data lines that failed JSON parsing. */
  malformedFragments: number;
};

/**
 * Races a stream read against the stall deadline: resolves `null` when the
 * gateway has delivered nothing for STREAM_STALL_TIMEOUT_MS, without leaving
 * the underlying read dangling (it settles on its own later and is ignored).
 */
async function readWithStallGuard(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<null>(resolve => {
        stallTimer = setTimeout(() => resolve(null), STREAM_STALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}

/**
 * Reads a streamed OpenAI-compatible chat completion for the agent loop: text
 * deltas are forwarded to `onChunk` as they arrive, and `delta.tool_calls`
 * fragments are stitched back into complete tool calls. Falls back to the
 * buffered JSON body when the gateway ignores the `stream` flag.
 */
export async function readGatewayStreamedChatResult(
  response: Response,
  resolvedModel: string,
  onChunk: (chunk: string) => void
): Promise<StreamedGatewayChat> {
  const isEventStream =
    response.body !== null &&
    (response.headers.get("content-type") ?? "").includes("text/event-stream");
  if (!isEventStream) {
    const payload = (await response.json().catch(() => undefined)) as
      | {
          choices?: Array<{
            message?: {
              content?: string | null;
              tool_calls?: Array<{
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
          model?: string;
          usage?: GatewayCompletion["usage"];
        }
      | undefined;
    const choice = payload?.choices?.[0]?.message;
    const text = typeof choice?.content === "string" ? choice.content : "";
    if (text) onChunk(text);
    const toolCalls: GatewayToolCall[] = (choice?.tool_calls ?? [])
      .filter(call => call?.function?.name)
      .map(call => ({
        id: String(call.id ?? `call-${Math.random().toString(36).slice(2)}`),
        name: String(call.function!.name),
        arguments:
          typeof call.function!.arguments === "string"
            ? call.function!.arguments
            : "{}",
      }));
    return {
      text,
      toolCalls,
      model: payload?.model ?? resolvedModel,
      usage: payload?.usage ?? null,
      error: (payload as { error?: { message?: string } } | undefined)?.error
        ?.message ?? null,
      finishReason:
        (payload as
          | { choices?: Array<{ finish_reason?: string }> }
          | undefined)?.choices?.[0]?.finish_reason ?? null,
      malformedFragments: 0,
    };
  }
  let text = "";
  let model: string | null = null;
  let streamError: string | null = null;
  let finishReason: string | null = null;
  let malformedFragments = 0;
  const calls: Array<{ id: string; name: string; arguments: string }> = [];
  try {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const read = await readWithStallGuard(reader);
      if (!read) {
        // The gateway went silent mid-stream (proxy timeout, dropped
        // connection) instead of throwing - cancel and fail as unavailable so
        // the agent loop can retry instead of hanging forever.
        await reader.cancel().catch(() => {});
        throw new MistralGatewayClientError(
          "The AI service stopped responding mid-stream. Please retry shortly.",
          "unavailable"
        );
      }
      if (read.done) break;
      const value = read.value;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const event = JSON.parse(data) as {
            error?: { message?: string } | string;
            model?: string;
            choices?: Array<{
              finish_reason?: string;
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          if (typeof event.model === "string" && event.model) {
            model = event.model;
          }
          if (typeof event.error === "string") {
            streamError = streamError ?? event.error;
          } else if (
            event.error &&
            typeof event.error.message === "string" &&
            event.error.message
          ) {
            streamError = streamError ?? event.error.message;
          }
          const lastChoice = event.choices?.[0];
          if (
            lastChoice &&
            typeof lastChoice.finish_reason === "string" &&
            lastChoice.finish_reason
          ) {
            finishReason = lastChoice.finish_reason;
          }
          const delta = lastChoice?.delta;
          if (!delta) continue;
          if (typeof delta.content === "string" && delta.content.length > 0) {
            text += delta.content;
            onChunk(delta.content);
          }
          for (const fragment of delta.tool_calls ?? []) {
            const index =
              typeof fragment.index === "number" ? fragment.index : 0;
            const slot = (calls[index] ??= {
              id: "",
              name: "",
              arguments: "",
            });
            if (typeof fragment.id === "string" && fragment.id) {
              slot.id = fragment.id;
            }
            if (
              typeof fragment.function?.name === "string" &&
              fragment.function.name
            ) {
              slot.name = fragment.function.name;
            }
            if (typeof fragment.function?.arguments === "string") {
              slot.arguments += fragment.function.arguments;
            }
          }
        } catch {
          // Ignore malformed stream fragments, but count them so an empty
          // completion can be diagnosed from the server logs.
          malformedFragments += 1;
        }
      }
    }
  } catch (error) {
    if (error instanceof MistralGatewayClientError) throw error;
    throw new MistralGatewayClientError(
      "The AI service interrupted the response stream. Please retry shortly.",
      "unavailable"
    );
  }
  const toolCalls: GatewayToolCall[] = calls
    .filter(call => call.name)
    .map(call => ({
      id: call.id || `call-${Math.random().toString(36).slice(2)}`,
      name: call.name,
      arguments: call.arguments || "{}",
    }));
  return {
    text,
    toolCalls,
    model: model ?? resolvedModel,
    usage: null,
    error: streamError,
    finishReason,
    malformedFragments,
  };
}

/**
 * Runs one model attempt with pool-overload degradation: when the resolved
 * chat model fails with an upstream overload (HTTP 429 - z.ai error 1305
 * free-pool congestion), the request retries once on the configured
 * pool-fallback model, then - on Z.ai, where a third free pool exists - the
 * last-resort model, and later requests skip straight to the fallback for
 * POOL_DEGRADE_MS. Fallback attempts reuse the run's allowance claim, so
 * they are not double-charged. If every pool in the chain is overloaded, the
 * degradation window ends early so the next request retries the primary
 * model instead of pinning to a dead pool.
 */
async function attemptWithPoolFallback<T>(
  status: Awaited<ReturnType<typeof getMistralGatewayStatus>>,
  claim: NonNullable<
    Awaited<ReturnType<typeof claimMistralInferenceRequestForUser>>
  >,
  resolvedModel: string,
  attempt: (model: string) => Promise<T>,
  kiloAttempt?: (model: string) => Promise<T>
): Promise<T> {
  const poolFallback = configuredTextFallbackModel();
  const lastResort = configuredLastResortModel();
  // Overload retry chain: the resolved model, then the configured pool
  // fallback, then (Z.ai only) the last-resort model. Deduplicated so a
  // repeated id (e.g. a vision turn resolved to the vision model, which is
  // also the last resort) is not attempted twice.
  const chain = [resolvedModel];
  for (const model of [poolFallback, lastResort]) {
    if (model && !chain.includes(model)) chain.push(model);
  }
  const degraded = poolDegradedUntil > Date.now();
  // While degraded, skip the congested primary and go straight to the pool
  // fallback (chain position 1 whenever a distinct fallback exists).
  const startIndex = degraded && chain.length > 1 ? 1 : 0;
  for (let index = startIndex; index < chain.length; index += 1) {
    try {
      return await attempt(chain[index]);
    } catch (error) {
      const isOverload =
        error instanceof MistralGatewayClientError && error.kind === "rate_limit";
      if (!isOverload) throw error;
      if (index + 1 < chain.length) {
        if (chain[index] === resolvedModel) {
          poolDegradedUntil = Date.now() + POOL_DEGRADE_MS;
          console.warn(
            `[Mistral gateway] ${resolvedModel} overloaded - retrying on pool fallback ${chain[index + 1]}, degraded for ${
              POOL_DEGRADE_MS / 60_000
            }m`
          );
        } else {
          console.warn(
            `[Mistral gateway] ${chain[index]} also overloaded - retrying on last resort ${chain[index + 1]}`
          );
        }
        continue;
      }
      // Every pool in the Z.ai chain is congested: try the zero-key Kilo
      // anonymous tier before giving up (Z.ai deployments only).
      const hops = kiloAttempt
        ? configuredKiloAnonymousHopModels(resolvedModel)
        : [];
      if (!kiloAttempt || hops.length === 0) {
        // No zero-key tier available (or every hop is disabled): end the
        // degradation window so the next request retries the primary model
        // instead of pinning to a dead pool.
        if (poolDegradedUntil > Date.now()) poolDegradedUntil = 0;
        throw error;
      }
      for (let hopIndex = 0; hopIndex < hops.length; hopIndex += 1) {
        try {
          const result = await kiloAttempt(hops[hopIndex]);
          // Keep the degradation window open: the primary pools are still
          // congested, so the next request should skip straight past them
          // (and reach this tier again) instead of re-probing each dead pool.
          console.warn(
            `[Mistral gateway] Z.ai chain fully congested - served by the Kilo anonymous tier ${hops[hopIndex]}`
          );
          return result;
        } catch (kiloError) {
          const kiloOverload =
            kiloError instanceof MistralGatewayClientError &&
            kiloError.kind === "rate_limit";
          if (!kiloOverload) throw kiloError;
          if (hopIndex + 1 < hops.length) {
            console.warn(
              `[Mistral gateway] Kilo anonymous hop ${hops[hopIndex]} also overloaded - trying ${hops[hopIndex + 1]}`
            );
            continue;
          }
          // The zero-key floor is congested too: end the degradation window
          // so the next request retries the primary model.
          if (poolDegradedUntil > Date.now()) poolDegradedUntil = 0;
          throw kiloError;
        }
      }
      throw new Error("unreachable");
    }
  }
  throw new Error("unreachable");
}

export async function chatWithMistralGateway(
  ownerId: number,
  messages: GatewayChatMessage[],
  options: {
    tools?: GatewayToolDefinition[];
    model?: string;
    /** When set, the final text streams chunk-by-chunk as it arrives. */
    onChunk?: (chunk: string) => void;
    /** Abort in-flight completions when the user stops the run (/stop). */
    signal?: AbortSignal;
  } = {}
): Promise<GatewayChatResult> {
  const status = await getMistralGatewayStatus(ownerId);
  if (
    !status.configured ||
    !status.reachable ||
    (status.providerConfigurationKnown && !status.providerConfigured)
  ) {
    throw new MistralGatewayClientError(
      "Nova’s AI service is not connected yet. Please try again after the gateway configuration is complete.",
      "configuration"
    );
  }
  const claim = await claimMistralInferenceRequestForUser(
    ownerId,
    status.allowance.maxRequests
  );
  if (!claim) {
    throw new MistralGatewayClientError(
      "This workspace has reached Nova’s configured AI request allowance. New inference requests are blocked until an administrator explicitly raises the cap.",
      "allowance_reached"
    );
  }
  const resolvedModel = options.model?.trim() || status.model;
  const kiloTarget = zaiGatewayToken() ? kiloGatewayTarget() : undefined;
  return attemptWithPoolFallback(
    status,
    claim,
    resolvedModel,
    model => attemptGatewayChat(status, claim, messages, options, model),
    kiloTarget
      ? model =>
          attemptGatewayChat(status, claim, messages, options, model, kiloTarget)
      : undefined
  );
}

/**
 * One OpenAI-compatible chat attempt against a specific model, streaming or
 * buffered. Extracted from chatWithMistralGateway so the pool-overload
 * fallback can retry the same request against a different model without
 * re-claiming the inference allowance.
 */
async function attemptGatewayChat(
  status: Awaited<ReturnType<typeof getMistralGatewayStatus>>,
  claim: NonNullable<
    Awaited<ReturnType<typeof claimMistralInferenceRequestForUser>>
  >,
  messages: GatewayChatMessage[],
  options: {
    tools?: GatewayToolDefinition[];
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
  },
  resolvedModel: string,
  target?: { baseUrl: string; token?: string }
): Promise<GatewayChatResult> {
  // The gateway occasionally returns a 200 completion with no text and no
  // tool calls (seen on long tool-calling runs). One automatic retry absorbs
  // those transient empties so the user never sees a dead reply; the request
  // allowance was already claimed once, so the retry does not double-charge.
  const EMPTY_COMPLETION_RETRIES = 1;
  const fetchChatCompletion = () =>
    gatewayFetch(
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          ...(options.tools?.length
            ? { tools: options.tools, tool_choice: "auto" }
            : {}),
          ...(options.onChunk ? { stream: true } : {}),
        }),
      },
      CHAT_REQUEST_TIMEOUT_MS,
      options.signal,
      target
    );
  const describeEmptyCompletion = (details: string[]) => {
    const suffix = details.length ? ` (${details.join("; ")})` : "";
    console.warn(
      `[Mistral gateway] empty completion for model ${resolvedModel}${suffix}`
    );
  };
  if (options.onChunk) {
    let streamed: StreamedGatewayChat | null = null;
    let upstreamError: string | null = null;
    for (
      let attempt = 0;
      attempt <= EMPTY_COMPLETION_RETRIES && !streamed;
      attempt += 1
    ) {
      const response = await fetchChatCompletion();
      if (!response.ok) {
        const payload = (await response.json().catch(() => undefined)) as
          | GatewayCompletion
          | { error?: { message?: string } }
          | undefined;
        const message = gatewayErrorMessageFromPayload(payload);
        throw new MistralGatewayClientError(
          message ??
            describeMistralError(payload, response.status) ??
            "Nova’s AI service is temporarily unavailable. Please retry shortly.",
          classifyGatewayHttpError(response.status)
        );
      }
      const attemptResult = await readGatewayStreamedChatResult(
        response,
        resolvedModel,
        options.onChunk
      );
      if (attemptResult.text || attemptResult.toolCalls.length) {
        streamed = attemptResult;
        break;
      }
      upstreamError = attemptResult.error ?? upstreamError;
      describeEmptyCompletion([
        ...(upstreamError ? [`error: ${upstreamError}`] : []),
        ...(attemptResult.finishReason
          ? [`finish_reason=${attemptResult.finishReason}`]
          : []),
        ...(attemptResult.malformedFragments
          ? [`${attemptResult.malformedFragments} malformed fragments`]
          : []),
        ...(attempt < EMPTY_COMPLETION_RETRIES
          ? ["retrying"]
          : ["giving up"]),
      ]);
    }
    if (!streamed) {
      throw new MistralGatewayClientError(
        upstreamError
          ? `The AI service returned an error completion: ${upstreamError}`
          : "The AI service returned an invalid completion. Please retry shortly.",
        "invalid_response"
      );
    }
    return {
      text: streamed.text,
      toolCalls: streamed.toolCalls,
      model: streamed.model ?? resolvedModel,
      usage: streamed.usage,
      allowance: {
        usedRequests: claim.usedRequests,
        maxRequests: status.allowance.maxRequests,
        remainingRequests:
          status.allowance.maxRequests === null
            ? null
            : Math.max(
                0,
                status.allowance.maxRequests - claim.usedRequests
              ),
        exhausted:
          status.allowance.maxRequests !== null &&
          claim.usedRequests >= status.allowance.maxRequests,
      },
    };
  }
  let buffered: {
    text: string;
    toolCalls: GatewayToolCall[];
    payload: GatewayCompletion | Record<string, unknown>;
  } | null = null;
  let bufferedUpstreamError: string | null = null;
  for (
    let attempt = 0;
    attempt <= EMPTY_COMPLETION_RETRIES && !buffered;
    attempt += 1
  ) {
    const response = await fetchChatCompletion();
    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => undefined)) as
        | GatewayCompletion
        | { error?: { message?: string } }
        | undefined;
      const message = gatewayErrorMessageFromPayload(errorPayload);
      throw new MistralGatewayClientError(
        message ??
          describeMistralError(errorPayload, response.status) ??
          "Nova’s AI service is temporarily unavailable. Please retry shortly.",
        classifyGatewayHttpError(response.status)
      );
    }
    const payload = (await response.json().catch(() => undefined)) as
      | GatewayCompletion
      | {
          choices?: Array<{
            message?: {
              content?: string | null;
              tool_calls?: Array<{
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
          model?: string;
          usage?: GatewayCompletion["usage"];
          error?: { message?: string };
        }
      | undefined;
    const choice = (
      payload as
        | {
            choices?: Array<{
              message?: {
                content?: string | null;
                tool_calls?: Array<{
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          }
        | undefined
    )?.choices?.[0]?.message;
    const text = typeof choice?.content === "string" ? choice.content : "";
    const toolCalls: GatewayToolCall[] = (choice?.tool_calls ?? [])
      .filter(call => call?.function?.name)
      .map(call => ({
        id: String(call.id ?? `call-${Math.random().toString(36).slice(2)}`),
        name: String(call.function!.name),
        arguments:
          typeof call.function?.arguments === "string"
            ? call.function.arguments
            : "{}",
      }));
    if (text || toolCalls.length) {
      buffered = { text, toolCalls, payload: payload ?? {} };
      break;
    }
    bufferedUpstreamError =
      (payload as { error?: { message?: string } } | undefined)?.error
        ?.message ?? bufferedUpstreamError;
    describeEmptyCompletion([
      ...(bufferedUpstreamError ? [`error: ${bufferedUpstreamError}`] : []),
      ...(attempt < EMPTY_COMPLETION_RETRIES ? ["retrying"] : ["giving up"]),
    ]);
  }
  if (!buffered) {
    throw new MistralGatewayClientError(
      bufferedUpstreamError
        ? `The AI service returned an error completion: ${bufferedUpstreamError}`
        : "The AI service returned an invalid completion. Please retry shortly.",
      "invalid_response"
    );
  }
  return {
    text: buffered.text,
    toolCalls: buffered.toolCalls,
    model:
      (buffered.payload as { model?: string } | undefined)?.model ??
      resolvedModel,
    usage:
      (buffered.payload as { usage?: GatewayCompletion["usage"] } | undefined)
        ?.usage ?? null,
    allowance: {
      usedRequests: claim.usedRequests,
      maxRequests: status.allowance.maxRequests,
      remainingRequests:
        status.allowance.maxRequests === null
          ? null
          : Math.max(0, status.allowance.maxRequests - claim.usedRequests),
      exhausted:
        status.allowance.maxRequests !== null &&
        claim.usedRequests >= status.allowance.maxRequests,
    },
  };

}
