import {
  claimNvidiaInferenceRequestForUser,
  getNvidiaInferenceAllowanceForUser,
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

let modelCache:
  { models: AvailableNvidiaModel[]; expiresAt: number } | undefined;

type GatewayHealthFlags = {
  configured: boolean;
  reachable: boolean;
  providerConfigured: boolean;
  providerConfigurationKnown: boolean;
};

let gatewayHealthCache:
  { key: string; expiresAt: number; flags: GatewayHealthFlags } | undefined;

/** Clears the in-process gateway health cache (used by tests between cases). */
export function resetNvidiaGatewayHealthCache() {
  gatewayHealthCache = undefined;
}

export class NvidiaGatewayClientError extends Error {
  constructor(
    message: string,
    public readonly kind:
      "configuration" | "unavailable" | "rate_limit" | "invalid_response"
  ) {
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
  const token =
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.NOVA_NVIDIA_GATEWAY_TOKEN?.trim();
  return token && token.length >= 32 ? token : undefined;
}

/** Best-effort human-readable description of a failed NVIDIA HTTP response. */
function describeNvidiaError(
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
  return `NVIDIA request failed (${parts.join(" · ")})`;
}

/**
 * Daily NVIDIA inference request cap per workspace. Returns null (no cap) unless
 * NVIDIA_MAX_REQUESTS_PER_WORKSPACE is set to a positive integer; "0", "none",
 * "unlimited", or an unset/invalid value all mean unlimited.
 */
function getMaxRequests(): number | null {
  const raw =
    process.env.NVIDIA_MAX_REQUESTS_PER_WORKSPACE?.trim().toLowerCase();
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
      : "NVIDIA inference is temporarily unavailable. Please retry shortly.";
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

async function gatewayFetch(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const baseUrl = configuredGatewayUrl();
  const token = configuredGatewayToken();
  if (!baseUrl || !token)
    throw new NvidiaGatewayClientError(
      "NVIDIA inference is not connected yet. An administrator must configure Nova’s server-only gateway connection.",
      "configuration"
    );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...serviceHeaders(token), ...init.headers },
      signal: controller.signal,
    });
  } catch (error) {
    throw new NvidiaGatewayClientError(
      sanitizeGatewayError(error),
      "unavailable"
    );
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
    model: DEFAULT_NVIDIA_MODEL,
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
    return { ...base, model: defaultNvidiaModel(), ...gatewayHealthCache.flags };
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
        | NvidiaModelsResponse
        | undefined;
      const models = parseNvidiaModels(payload);
      if (models.length > 0) cacheNvidiaModels(models);
    }
    return { ...base, model: defaultNvidiaModel(), ...flags };
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
    return { ...base, model: defaultNvidiaModel(), ...flags };
  }
}

function modelKind(model: NvidiaModel): "text" | "vision" | undefined {
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
  if (
    explicitModalities.some(value =>
      /audio|video|image_generation|image-generation|text-to-image/i.test(value)
    )
  )
    return undefined;
  if (explicitModalities.length > 0) {
    if (!explicitModalities.some(value => /text/i.test(value)))
      return undefined;
    return explicitModalities.some(value => /image|vision/i.test(value))
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
  // NVIDIA's OpenAI-compatible /v1/models response normally only includes the
  // model ID and ownership fields. Treat metadata-poor models as text chat models
  // unless their ID identifies a known non-chat model family; otherwise the picker
  // is empty even though the gateway successfully returned available models.
  if (/(^|[\/_-])(embed|embedding|rerank|reranker|bge|e5|retriev|asr|speech|tts|audio|flux|stable-diffusion|image-generator|text-to-image|video)([\/_-]|$)/i.test(model.id))
    return undefined;
  return /(^|[\/_-])(vision|vlm|multimodal|visual-language)([\/_-]|$)/i.test(
    model.id
  )
    ? "vision"
    : "text";
}

/** The text chat model used when no vision-capable model has been discovered. */
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";

/** Test hook: drop the discovered-model cache between suites. */
export function resetNvidiaModelCache() {
  modelCache = undefined;
}

/**
 * The default chat model, preferring a vision-capable one so uploaded images
 * reach the model directly. Falls back to the text default until discovery
 * finds a vision model.
 */
export function defaultNvidiaModel(): string {
  if (!modelCache || modelCache.expiresAt <= Date.now()) return DEFAULT_NVIDIA_MODEL;
  const vision = modelCache.models.filter(model => model.kind === "vision");
  return vision.find(model => model.id.includes("nemotron"))?.id ?? vision[0]?.id ?? DEFAULT_NVIDIA_MODEL;
}

function parseNvidiaModels(payload: NvidiaModelsResponse | undefined): AvailableNvidiaModel[] {
  const rawData = payload?.data;
  if (!Array.isArray(rawData)) return [];
  return rawData
    .filter(
      (model): model is NvidiaModel =>
        typeof model?.id === "string" && model.id.trim().length > 0
    )
    .map(model => ({ ...model, id: model.id.trim() }))
    .map(model => ({ ...model, kind: modelKind(model) }))
    .filter(
      (model): model is AvailableNvidiaModel => model.kind !== undefined
    );
}

function cacheNvidiaModels(models: AvailableNvidiaModel[]) {
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
 * Discovers chat-capable NVIDIA text/VLM models from the gateway's OpenAI-compatible
 * /v1/models endpoint. Vision-language models remain eligible because they accept text
 * chat as well as image input. Results are cached briefly for model pickers.
 */
/** Returns the list of available NVIDIA models, cached for five minutes. */
export async function listNvidiaModels(forceRefresh = false) {
  if (!forceRefresh && modelCache && modelCache.expiresAt > Date.now())
    return modelCache.models;
  const response = await gatewayFetch("/models");
  const payload = (await response.json().catch(() => undefined)) as
    NvidiaModelsResponse | { error?: { message?: string } } | undefined;
  if (!response.ok) {
    const message =
      payload && "error" in payload ? payload.error?.message : undefined;
    throw new NvidiaGatewayClientError(
      message ??
        describeNvidiaError(payload, response.status) ??
        "NVIDIA model discovery is temporarily unavailable.",
      response.status === 429 ? "rate_limit" : "unavailable"
    );
  }
  const models = parseNvidiaModels(payload as NvidiaModelsResponse | undefined);
  if (models.length === 0) {
    throw new NvidiaGatewayClientError(
      "NVIDIA returned no available text or vision-language models.",
      "invalid_response"
    );
  }
  return cacheNvidiaModels(models);
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
    throw new NvidiaGatewayClientError(
      message ??
        describeNvidiaError(payload, response.status) ??
        "NVIDIA inference is temporarily unavailable. Please retry shortly.",
      response.status === 429 ? "rate_limit" : "unavailable"
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

export async function completeWithNvidiaGateway(
  ownerId: number,
  prompt: string,
  modelId?: string,
  onChunk?: (chunk: string) => void
) {
  const status = await getNvidiaGatewayStatus(ownerId);
  if (
    !status.configured ||
    !status.reachable ||
    (status.providerConfigurationKnown && !status.providerConfigured)
  ) {
    throw new NvidiaGatewayClientError(
      "NVIDIA inference is not connected yet. Please try again after the server-only gateway configuration is complete.",
      "configuration"
    );
  }
  const claim = await claimNvidiaInferenceRequestForUser(
    ownerId,
    status.allowance.maxRequests
  );
  if (!claim) {
    throw new NvidiaGatewayClientError(
      "This workspace has reached Nova’s configured NVIDIA request allowance. New inference requests are blocked until an administrator explicitly raises the cap.",
      "rate_limit"
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
      throw new NvidiaGatewayClientError(
        "NVIDIA returned an invalid completion. Please retry shortly.",
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
    throw new NvidiaGatewayClientError(
      message ??
        describeNvidiaError(payload, response.status) ??
        "NVIDIA inference is temporarily unavailable. Please retry shortly.",
      response.status === 429 ? "rate_limit" : "unavailable"
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
    throw new NvidiaGatewayClientError(
      "NVIDIA returned an invalid completion. Please retry shortly.",
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
        // connection) instead of throwing — cancel and fail as unavailable so
        // the agent loop can retry instead of hanging forever.
        await reader.cancel().catch(() => {});
        throw new NvidiaGatewayClientError(
          "NVIDIA stopped responding mid-stream. Please retry shortly.",
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
    if (error instanceof NvidiaGatewayClientError) throw error;
    throw new NvidiaGatewayClientError(
      "NVIDIA interrupted the response stream. Please retry shortly.",
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

export async function chatWithNvidiaGateway(
  ownerId: number,
  messages: GatewayChatMessage[],
  options: {
    tools?: GatewayToolDefinition[];
    model?: string;
    /** When set, the final text streams chunk-by-chunk as it arrives. */
    onChunk?: (chunk: string) => void;
  } = {}
): Promise<GatewayChatResult> {
  const status = await getNvidiaGatewayStatus(ownerId);
  if (
    !status.configured ||
    !status.reachable ||
    (status.providerConfigurationKnown && !status.providerConfigured)
  ) {
    throw new NvidiaGatewayClientError(
      "NVIDIA inference is not connected yet. Please try again after the server-only gateway configuration is complete.",
      "configuration"
    );
  }
  const claim = await claimNvidiaInferenceRequestForUser(
    ownerId,
    status.allowance.maxRequests
  );
  if (!claim) {
    throw new NvidiaGatewayClientError(
      "This workspace has reached Nova’s configured NVIDIA request allowance. New inference requests are blocked until an administrator explicitly raises the cap.",
      "rate_limit"
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
      CHAT_REQUEST_TIMEOUT_MS
    );
  const describeEmptyCompletion = (details: string[]) => {
    const suffix = details.length ? ` (${details.join("; ")})` : "";
    console.warn(
      `[NVIDIA gateway] empty completion for model ${resolvedModel}${suffix}`
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
        throw new NvidiaGatewayClientError(
          message ??
            describeNvidiaError(payload, response.status) ??
            "NVIDIA inference is temporarily unavailable. Please retry shortly.",
          response.status === 429 ? "rate_limit" : "unavailable"
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
      throw new NvidiaGatewayClientError(
        upstreamError
          ? `NVIDIA returned an error completion: ${upstreamError}`
          : "NVIDIA returned an invalid completion. Please retry shortly.",
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
      throw new NvidiaGatewayClientError(
        message ??
          describeNvidiaError(errorPayload, response.status) ??
          "NVIDIA inference is temporarily unavailable. Please retry shortly.",
        response.status === 429 ? "rate_limit" : "unavailable"
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
    throw new NvidiaGatewayClientError(
      bufferedUpstreamError
        ? `NVIDIA returned an error completion: ${bufferedUpstreamError}`
        : "NVIDIA returned an invalid completion. Please retry shortly.",
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