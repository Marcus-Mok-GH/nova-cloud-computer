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

type GatewayCompletion = {
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
function classifyGatewayHttpError(status: number): MistralGatewayClientErrorKind {
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

function sanitizeGatewayError(error: unknown) {
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
  externalSignal?: AbortSignal
) {
  const baseUrl = configuredGatewayUrl();
  const token = configuredGatewayToken();
  if (!baseUrl || !token)
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
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...serviceHeaders(token), ...init.headers },
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
 * Operator override for the text fallback model id, mirroring
 * configuredDefaultChatModel for deployments on a non-Mistral provider.
 */
export function configuredTextFallbackModel(): string {
  const override = zaiGatewayToken()
    ? process.env.ZAI_FALLBACK_MODEL?.trim()
    : process.env.MISTRAL_FALLBACK_MODEL?.trim();
  return override || TEXT_FALLBACK_MODEL;
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
    const message =
      payload && "error" in payload ? payload.error?.message : undefined;
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
      throw new MistralGatewayClientError(
        "The AI service returned an invalid completion. Please retry shortly.",
        "invalid_response"
      );
    }
    return {
      text,
      model: completion.model ?? resolvedModel,
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
    const message =
      payload && "error" in payload ? payload.error?.message : undefined;
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
    model: completion?.model ?? resolvedModel,
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
async function readGatewayStreamedChatResult(
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
      options.signal
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
        const message =
          payload && "error" in payload ? payload.error?.message : undefined;
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
      const message =
        errorPayload && "error" in errorPayload
          ? errorPayload.error?.message
          : undefined;
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