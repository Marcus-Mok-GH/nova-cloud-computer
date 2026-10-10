import {
  claimDailyCreditForUser,
  claimInferenceRequestForUser,
  getInferenceAllowanceForUser,
  settleDailyCreditUsageForUser,
} from "./db";
import { calculateInferenceCredits } from "./credits";

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
/** Patient timeout for long single-shot completions (e.g. automation planning). */
export const LONG_COMPLETION_TIMEOUT_MS = CHAT_REQUEST_TIMEOUT_MS;
const ERROR_MESSAGE_LIMIT = 600;
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

/** One selectable model in the built-in gateway's catalogue (the picker's shape). */
export type AvailableGatewayModel = {
  id: string;
  kind: "text" | "vision";
};

type GatewayHealthFlags = {
  configured: boolean;
  reachable: boolean;
  providerConfigured: boolean;
  providerConfigurationKnown: boolean;
};

let gatewayHealthCache:
  { key: string; expiresAt: number; flags: GatewayHealthFlags } | undefined;

/** Clears the in-process gateway health cache (used by tests between cases). */
export function resetAiGatewayHealthCache() {
  gatewayHealthCache = undefined;
}

export type AiGatewayClientErrorKind =
  | "configuration"
  | "unavailable"
  | "rate_limit"
  | "allowance_reached"
  | "credits_exhausted"
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
export function classifyGatewayHttpError(status: number): AiGatewayClientErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "configuration";
  if (status >= 400 && status < 500 && status !== 408 && status !== 425)
    return "client_error";
  return "unavailable";
}

export class AiGatewayClientError extends Error {
  constructor(
    message: string,
    public readonly kind: AiGatewayClientErrorKind
  ) {
    super(message);
    this.name = "AiGatewayClientError";
  }
}

/**
 * Nova's built-in AI gateway targets Token Harbor (https://tokenharbor.ai), a
 * unified OpenAI-compatible gateway, behind the server-only TOKENHARBOR_API_KEY
 * credential. The gateway serves exactly one model (TOKENHARBOR_CHAT_MODEL);
 * there is no provider mode, discovery ladder, or fallback chain.
 */
const TOKENHARBOR_API_BASE_URL = "https://tokenharbor.ai/v1";

/** The single model Nova's built-in gateway serves. */
export const TOKENHARBOR_CHAT_MODEL = "deepseek-v4.1-flash:free";

/**
 * The Token Harbor credential. Mirroring the providers this replaced, a value
 * shorter than 32 characters is treated as a placeholder rather than a key.
 */
function tokenHarborToken() {
  const token = process.env.TOKENHARBOR_API_KEY?.trim();
  return token && token.length >= 32 ? token : undefined;
}

/** Optional HTTPS override for the Token Harbor base URL (tests, mirrors). */
function configuredGatewayUrl() {
  const raw =
    process.env.TOKENHARBOR_GATEWAY_URL?.trim() || TOKENHARBOR_API_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function configuredGatewayToken() {
  return tokenHarborToken();
}

/**
 * Best-effort upstream error text from an OpenAI-compatible error payload.
 * Multi-gateway relays wrap the provider's real error in error.metadata.raw
 * behind a generic message ("Provider returned error"), so prefer the raw
 * text when it is present.
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

/** Best-effort human-readable description of a failed gateway HTTP response. */
function describeGatewayError(
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
  return `Gateway request failed (${parts.join(" · ")})`;
}

/**
 * Daily inference request cap per workspace. Returns null (no cap) unless
 * TOKENHARBOR_MAX_REQUESTS_PER_WORKSPACE is set to a positive integer; "0", "none",
 * "unlimited", or an unset/invalid value all mean unlimited.
 */
function getMaxRequests(): number | null {
  const raw =
    process.env.TOKENHARBOR_MAX_REQUESTS_PER_WORKSPACE?.trim().toLowerCase();
  if (!raw || raw === "0" || raw === "none" || raw === "unlimited") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1
    ? Math.min(parsed, MAX_CONFIGURED_REQUESTS)
    : null;
}

/**
 * Node's fetch (undici) rejects an aborted request with an AbortError whose
 * message is the bare engine text "This operation was aborted" — usually
 * triggered by the request timeouts in gatewayFetch. Map it (and
 * AbortSignal.timeout's TimeoutError) to user-facing wording instead of
 * leaking raw engine messages; genuine /stop aborts are handled by the
 * callers before this runs.
 */
function isAbortOrTimeoutError(error: unknown): boolean {
  const name =
    error instanceof Object && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  const message = error instanceof Error ? error.message : "";
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /operation was aborted/i.test(message)
  );
}

export function sanitizeGatewayError(error: unknown) {
  if (isAbortOrTimeoutError(error)) {
    return "Nova’s AI service took too long to respond. Please try again.";
  }
  const message =
    error instanceof Error
      ? error.message
      : "Nova’s AI service is temporarily unavailable. Please retry shortly.";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [private credential]")
    .slice(0, ERROR_MESSAGE_LIMIT);
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
    throw new AiGatewayClientError(
      "Nova’s AI service is not connected yet. An administrator must finish setting it up.",
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
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
  } catch (error) {
    // Only a user /stop is "stopped"; timeouts and gateway outages stay
    // "unavailable" so transient-failure handling can retry them.
    throw new AiGatewayClientError(
      externalSignal?.aborted
        ? "This reply was stopped with /stop."
        : sanitizeGatewayError(error),
      externalSignal?.aborted ? "stopped" : "unavailable"
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortWithStop);
  }
}

export function isAiGatewayConfigured() {
  return !!(configuredGatewayUrl() && configuredGatewayToken());
}

/** Returns cached or freshly-probed gateway health flags and the user's current allowance. */
export async function getAiGatewayStatus(ownerId: number) {
  const allowance = await getInferenceAllowanceForUser(ownerId);
  const maxRequests = getMaxRequests();
  const base = {
    // Legacy identifier: this matches the `model_provider` enum value stored
    // in the database for Nova's built-in gateway, so it stays as-is.
    provider: "mistral" as const,
    model: TOKENHARBOR_CHAT_MODEL,
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
  if (!isAiGatewayConfigured()) {
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
    return { ...base, model: TOKENHARBOR_CHAT_MODEL, ...gatewayHealthCache.flags };
  }
  try {
    const response = await gatewayFetch("/models");
    // The provider has no dedicated health route: a successful /models round-trip proves
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
    return { ...base, model: TOKENHARBOR_CHAT_MODEL, ...flags };
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
    return { ...base, model: TOKENHARBOR_CHAT_MODEL, ...flags };
  }
}

/**
 * Per-model deep-thinking request fields. GLM-4.5-and-newer models accept
 * `thinking: { type: "enabled" }` in the OpenAI-compatible body; GLM-5.2 and
 * newer additionally take `reasoning_effort`, where "max" is the deepest
 * reasoning served. Models without a thinking mode (the built-in gateway's
 * DeepSeek model included) get none, since sending unknown fields to a strict
 * endpoint risks a rejection. Exported so the BYOK gateway applies the same
 * per-model logic to a workspace's custom GLM-family models.
 */
export function reasoningParamsForModel(modelId: string): Record<string, unknown> {
  const match = /^glm-(\d+)(?:\.(\d+))?/i.exec(modelId.trim());
  if (!match) return {};
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  const thinks = major > 4 || (major === 4 && minor >= 5);
  if (!thinks) return {};
  const params: Record<string, unknown> = { thinking: { type: "enabled" } };
  if (major > 5 || (major === 5 && minor >= 2)) params.reasoning_effort = "max";
  return params;
}

/**
 * The built-in gateway's model catalogue. Nova serves exactly one model -
 * Token Harbor's free DeepSeek V4.1 Flash - so the model picker and the
 * settings validation see a single entry. `_forceRefresh` is retained for
 * call-site compatibility; there is no discovery round-trip to refresh.
 */
export async function listGatewayModels(
  _forceRefresh = false
): Promise<AvailableGatewayModel[]> {
  return [{ id: TOKENHARBOR_CHAT_MODEL, kind: "vision" }];
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
    throw new AiGatewayClientError(
      message ??
        describeGatewayError(payload, response.status) ??
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

async function claimDailyCreditOrThrow(ownerId: number) {
  const claim = await claimDailyCreditForUser(ownerId);
  if (!claim) {
    throw new AiGatewayClientError(
      "Your daily Nova credits are used up. They reset tomorrow.",
      "credits_exhausted"
    );
  }
}

async function settleGatewayCredit(ownerId: number, model: string | undefined, usage: GatewayCompletion["usage"] | null) {
  const chargedCredits = calculateInferenceCredits(model, usage);
  try {
    await settleDailyCreditUsageForUser(ownerId, chargedCredits, usage);
  } catch (error) {
    console.error("[Credits] Could not settle provider token usage", error instanceof Error ? error.message : error);
  }
  return chargedCredits;
}

export async function completeWithAiGateway(
  ownerId: number,
  prompt: string,
  modelId?: string,
  onChunk?: (chunk: string) => void,
  timeoutMs: number = REQUEST_TIMEOUT_MS
) {
  const status = await getAiGatewayStatus(ownerId);
  if (
    !status.configured ||
    !status.reachable ||
    (status.providerConfigurationKnown && !status.providerConfigured)
  ) {
    throw new AiGatewayClientError(
      "Nova’s AI service is not connected yet. Please try again after the gateway configuration is complete.",
      "configuration"
    );
  }
  await claimDailyCreditOrThrow(ownerId);
  const claim = await claimInferenceRequestForUser(
    ownerId,
    status.allowance.maxRequests
  );
  if (!claim) {
    throw new AiGatewayClientError(
      "This workspace has reached Nova’s configured AI request allowance. New inference requests are blocked until an administrator explicitly raises the cap.",
      "allowance_reached"
    );
  }
  const resolvedModel = modelId?.trim() || status.model;
  const postPromptCompletion = async (model: string) => {
  const response = await gatewayFetch("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      ...(onChunk ? { stream: true } : {}),
    }),
  }, timeoutMs);
  if (onChunk) {
    const completion = await readGatewayStreamedCompletion(response, onChunk);
    const text = typeof completion.text === "string" ? completion.text : "";
    if (!text) {
      throw new AiGatewayClientError(
        "The AI service returned an invalid completion. Please retry shortly.",
        "invalid_response"
      );
    }
    return {
      text,
      model: completion.model ?? model,
      usage: completion.usage ?? null,
      allowance: allowanceSummary(
        status.allowance.maxRequests,
        claim.usedRequests
      ),
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
    throw new AiGatewayClientError(
      message ??
        describeGatewayError(payload, response.status) ??
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
    throw new AiGatewayClientError(
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
    allowance: allowanceSummary(
      status.allowance.maxRequests,
      claim.usedRequests
    ),
  };
  };
  const result = await postPromptCompletion(resolvedModel);
  const creditsCharged = await settleGatewayCredit(ownerId, result.model, result.usage);
  return { ...result, creditsCharged };
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
  /** The model's private reasoning, when the provider returned one. */
  reasoning?: string;
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
 * The allowance summary every gateway result carries. Derived in one place so
 * the remaining-requests math and the exhausted flag cannot drift between the
 * streaming and buffered return sites.
 */
function allowanceSummary(maxRequests: number | null, usedRequests: number) {
  return {
    usedRequests,
    maxRequests,
    remainingRequests:
      maxRequests === null ? null : Math.max(0, maxRequests - usedRequests),
    exhausted: maxRequests !== null && usedRequests >= maxRequests,
  };
}

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
  /** The model's private reasoning (reasoning_content deltas), when present. */
  reasoning: string;
};

/**
 * The model's private reasoning text from one raw field, tolerating both
 * shapes seen across gateways: Z.ai's reasoning_content and Kilo's reasoning
 * are plain strings, while some OpenRouter-style providers wrap the text as
 * `{ text }`. Returns "" when the field carries no reasoning text.
 */
function reasoningTextFrom(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const text = (raw as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

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
  onChunk: (chunk: string) => void,
  onReasoning?: (chunk: string) => void
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
    const bufferedReasoning =
      reasoningTextFrom(
        (choice as { reasoning_content?: unknown } | undefined)
          ?.reasoning_content
      ) ||
      reasoningTextFrom(
        (choice as { reasoning?: unknown } | undefined)?.reasoning
      );
    if (bufferedReasoning) onReasoning?.(bufferedReasoning);
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
      reasoning: bufferedReasoning,
    };
  }
  let text = "";
  let reasoning = "";
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
        throw new AiGatewayClientError(
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
          const reasoningChunk =
            reasoningTextFrom(
              (delta as { reasoning_content?: unknown }).reasoning_content
            ) ||
            reasoningTextFrom((delta as { reasoning?: unknown }).reasoning);
          if (reasoningChunk.length > 0) {
            reasoning += reasoningChunk;
            onReasoning?.(reasoningChunk);
          }
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
    if (error instanceof AiGatewayClientError) throw error;
    throw new AiGatewayClientError(
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
    reasoning,
  };
}

export async function chatWithAiGateway(
  ownerId: number,
  messages: GatewayChatMessage[],
  options: {
    tools?: GatewayToolDefinition[];
    model?: string;
    /** When set, the final text streams chunk-by-chunk as it arrives. */
    onChunk?: (chunk: string) => void;
    /** When set, the model's private reasoning streams as it arrives. */
    onReasoning?: (chunk: string) => void;
    /** Abort in-flight completions when the user stops the run (/stop). */
    signal?: AbortSignal;
  } = {}
): Promise<GatewayChatResult> {
  const status = await getAiGatewayStatus(ownerId);
  if (
    !status.configured ||
    !status.reachable ||
    (status.providerConfigurationKnown && !status.providerConfigured)
  ) {
    throw new AiGatewayClientError(
      "Nova’s AI service is not connected yet. Please try again after the gateway configuration is complete.",
      "configuration"
    );
  }
  await claimDailyCreditOrThrow(ownerId);
  const claim = await claimInferenceRequestForUser(
    ownerId,
    status.allowance.maxRequests
  );
  if (!claim) {
    throw new AiGatewayClientError(
      "This workspace has reached Nova’s configured AI request allowance. New inference requests are blocked until an administrator explicitly raises the cap.",
      "allowance_reached"
    );
  }
  const resolvedModel = options.model?.trim() || status.model;
  const result = await attemptGatewayChat(
    status,
    claim,
    messages,
    options,
    resolvedModel
  );
  await settleGatewayCredit(ownerId, result.model, result.usage);
  return result;
}

/**
 * One OpenAI-compatible chat attempt against the resolved model, streaming or
 * buffered. The request's inference allowance was already claimed by the caller.
 */
async function attemptGatewayChat(
  status: Awaited<ReturnType<typeof getAiGatewayStatus>>,
  claim: NonNullable<
    Awaited<ReturnType<typeof claimInferenceRequestForUser>>
  >,
  messages: GatewayChatMessage[],
  options: {
    tools?: GatewayToolDefinition[];
    onChunk?: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    signal?: AbortSignal;
  },
  resolvedModel: string
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
          // Deep thinking at maximum effort for every reasoning-capable
          // model (per-model: GLM-4.5+ takes thinking.type=enabled,
          // GLM-5.2+ also reasoning_effort=max).
          ...reasoningParamsForModel(resolvedModel),
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
      `[AI gateway] empty completion for model ${resolvedModel}${suffix}`
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
        throw new AiGatewayClientError(
          message ??
            describeGatewayError(payload, response.status) ??
            "Nova’s AI service is temporarily unavailable. Please retry shortly.",
          classifyGatewayHttpError(response.status)
        );
      }
      const attemptResult = await readGatewayStreamedChatResult(
        response,
        resolvedModel,
        options.onChunk,
        options.onReasoning
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
      throw new AiGatewayClientError(
        upstreamError
          ? `The AI service returned an error completion: ${upstreamError}`
          : "The AI service returned an invalid completion. Please retry shortly.",
        "invalid_response"
      );
    }
    return {
      text: streamed.text,
      toolCalls: streamed.toolCalls,
      ...(streamed.reasoning ? { reasoning: streamed.reasoning } : {}),
      model: streamed.model ?? resolvedModel,
      usage: streamed.usage,
      allowance: allowanceSummary(
        status.allowance.maxRequests,
        claim.usedRequests
      ),
    };
  }
  let buffered: {
    text: string;
    toolCalls: GatewayToolCall[];
    payload: GatewayCompletion | Record<string, unknown>;
    reasoning?: string;
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
      throw new AiGatewayClientError(
        message ??
          describeGatewayError(errorPayload, response.status) ??
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
    const bufferedReasoning =
      reasoningTextFrom(
        (choice as { reasoning_content?: unknown } | undefined)
          ?.reasoning_content
      ) ||
      reasoningTextFrom(
        (choice as { reasoning?: unknown } | undefined)?.reasoning
      );
    if (bufferedReasoning) options.onReasoning?.(bufferedReasoning);
    if (text || toolCalls.length) {
      buffered = { text, toolCalls, payload: payload ?? {}, ...(bufferedReasoning ? { reasoning: bufferedReasoning } : {}) };
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
    throw new AiGatewayClientError(
      bufferedUpstreamError
        ? `The AI service returned an error completion: ${bufferedUpstreamError}`
        : "The AI service returned an invalid completion. Please retry shortly.",
      "invalid_response"
    );
  }
  return {
    text: buffered.text,
    toolCalls: buffered.toolCalls,
    ...(buffered.reasoning ? { reasoning: buffered.reasoning } : {}),
    model:
      (buffered.payload as { model?: string } | undefined)?.model ??
      resolvedModel,
    usage:
      (buffered.payload as { usage?: GatewayCompletion["usage"] } | undefined)
        ?.usage ?? null,
    allowance: allowanceSummary(
      status.allowance.maxRequests,
      claim.usedRequests
    ),
  };

}
