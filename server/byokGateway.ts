import { lookup as dnsLookup } from "node:dns/promises";
import { decryptModelApiKey } from "./modelSecrets";
import { getActiveCustomModelForUser } from "./db";
import {
  chatWithMistralGateway,
  classifyGatewayHttpError,
  completeWithMistralGateway,
  MistralGatewayClientError,
  readGatewayStreamedChatResult,
  sanitizeGatewayError,
  type GatewayChatMessage,
  type GatewayChatResult,
  type GatewayCompletion,
  type GatewayToolCall,
  type GatewayToolDefinition,
} from "./mistralGateway";
import type { CustomModel } from "../drizzle/schema";

/**
 * BYOK ("bring your own key") inference: when a workspace selects one of its
 * custom models, all agent traffic is routed to that provider's
 * OpenAI-compatible endpoint with the user's own encrypted API key instead of
 * Nova's built-in Mistral gateway. Requests against a user's own provider do
 * not claim the built-in inference allowance.
 *
 * The request/response handling intentionally mirrors the Mistral gateway
 * (same message and tool-call schema, same SSE streaming) because every
 * supported endpoint speaks the OpenAI chat-completions dialect.
 */

const BYOK_CHAT_TIMEOUT_MS = 120_000;
const BYOK_TEST_TIMEOUT_MS = 25_000;
/** BYOK runs on the user's own provider, so there is no shared allowance to charge. */
const BYOK_ALLOWANCE = {
  usedRequests: 0,
  maxRequests: null,
  remainingRequests: null,
  exhausted: false,
} as const;

/**
 * Guards a user-supplied provider endpoint before any credential-bearing
 * request: HTTPS outside loopback (http stays available for local model
 * servers like Ollama/vLLM), and never link-local or cloud-metadata
 * addresses (SSRF targets such as 169.254.169.254).
 */
const SAFE_UPSTREAM_CACHE_MS = 5 * 60_000;
const safeUpstreamCache = new Map<string, number>();

function isPublicUpstreamIpv4(ip: string) {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return false; // this-network, private, loopback
  if (a === 169 && b === 254) return false; // link-local: AWS/GCP/Azure metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier NAT: Alibaba metadata
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast and reserved
  return true;
}

/** True only for globally routable addresses; blocks loopback, private, link-local, ULA, and metadata ranges. */
function isPublicUpstreamIp(ip: string) {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicUpstreamIpv4(mapped[1]);
  if (lower.includes(":")) {
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower)) return false; // fc00::/7 unique local
    if (/^fe[89ab]/.test(lower)) return false; // fe80::/10 link-local
    if (/^ff/.test(lower)) return false; // ff00::/8 multicast
    return true;
  }
  return isPublicUpstreamIpv4(ip);
}

function isLiteralLoopbackHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

export async function assertSafeUpstreamUrl(baseUrl: string) {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new MistralGatewayClientError("That provider endpoint is not a valid URL.", "configuration");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = isLiteralLoopbackHost(hostname);
  if (url.protocol !== "https:" && !isLoopback) {
    throw new MistralGatewayClientError(
      "Provider endpoints must use HTTPS. Plain http is only allowed for localhost servers.",
      "configuration"
    );
  }
  if ((safeUpstreamCache.get(hostname) ?? 0) > Date.now()) return;
  if (isLoopback) return; // the supported local-model case; nothing further to resolve
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch {
    throw new MistralGatewayClientError("That provider endpoint hostname could not be resolved.", "configuration");
  }
  for (const { address } of addresses) {
    if (!isPublicUpstreamIp(address)) {
      throw new MistralGatewayClientError(
        "That provider endpoint is not allowed: provider endpoints must be publicly reachable addresses, not private, link-local, or cloud-metadata hosts.",
        "configuration"
      );
    }
  }
  safeUpstreamCache.set(hostname, Date.now() + SAFE_UPSTREAM_CACHE_MS);
}

function chatCompletionsUrl(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function decryptCustomModelKey(model: CustomModel) {
  try {
    return decryptModelApiKey(model.encryptedApiKey);
  } catch {
    throw new MistralGatewayClientError(
      "Your saved provider key could not be decrypted. Re-enter the API key for this provider in Settings.",
      "configuration"
    );
  }
}

/** Fetch against the user's own provider; mirrors the gateway's timeout and /stop abort semantics. */
async function byokFetch(
  baseUrl: string,
  apiKey: string,
  init: RequestInit = {},
  timeoutMs = BYOK_CHAT_TIMEOUT_MS,
  externalSignal?: AbortSignal
) {
  // Redirects are followed manually so every hop is validated before the
  // credential-bearing request continues (no redirecting to private hosts).
  const BYOK_MAX_REDIRECTS = 3;
  const controller = new AbortController();
  const abortWithStop = () => controller.abort();
  externalSignal?.addEventListener("abort", abortWithStop, { once: true });
  if (externalSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await assertSafeUpstreamUrl(baseUrl);
    let requestUrl = chatCompletionsUrl(baseUrl);
    let response = await fetch(requestUrl, {
      ...init,
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
    for (let hop = 0; hop < BYOK_MAX_REDIRECTS; hop += 1) {
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) break;
      requestUrl = new URL(location, requestUrl).toString();
      await assertSafeUpstreamUrl(requestUrl);
      response = await fetch(requestUrl, {
        ...init,
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: controller.signal,
      });
    }
    return response;
  } catch (error) {
    // Guard rejections (bad URL, private host, failed DNS) keep their own kind.
    if (error instanceof MistralGatewayClientError) throw error;
    // Only a user /stop is "stopped"; timeouts and provider outages stay
    // "unavailable" so callers keep their normal retry handling.
    throw new MistralGatewayClientError(
      externalSignal?.aborted ? "This reply was stopped with /stop." : sanitizeGatewayError(error),
      externalSignal?.aborted ? "stopped" : "unavailable"
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortWithStop);
  }
}

/** One chat completion against the user's own provider, streaming or buffered. */
export async function chatWithCustomModel(
  model: CustomModel,
  messages: GatewayChatMessage[],
  options: {
    tools?: GatewayToolDefinition[];
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
  } = {}
): Promise<GatewayChatResult> {
  const apiKey = decryptCustomModelKey(model);
  const fetchChatCompletion = () =>
    byokFetch(
      model.baseUrl,
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          model: model.modelId,
          messages,
          ...(options.tools?.length
            ? { tools: options.tools, tool_choice: "auto" }
            : {}),
          ...(options.onChunk ? { stream: true } : {}),
        }),
      },
      BYOK_CHAT_TIMEOUT_MS,
      options.signal
    );

  const describeEmptyCompletion = (details: string[]) => {
    console.warn(
      `[BYOK gateway] empty completion for model ${model.modelId} at ${model.baseUrl}${details.length ? ` (${details.join("; ")})` : ""}`
    );
  };

  // Like the built-in gateway, absorb one transient empty completion.
  const EMPTY_COMPLETION_RETRIES = 1;
  if (options.onChunk) {
    let streamed:
      | { text: string; toolCalls: GatewayToolCall[] }
      | null = null;
    let upstreamError: string | null = null;
    for (
      let attempt = 0;
      attempt <= EMPTY_COMPLETION_RETRIES && !streamed;
      attempt += 1
    ) {
      const response = await fetchChatCompletion();
      if (!response.ok) throw await byokHttpError(response);
      const attemptResult = await readGatewayStreamedChatResult(
        response,
        model.modelId,
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
        ...(attempt < EMPTY_COMPLETION_RETRIES ? ["retrying"] : ["giving up"]),
      ]);
    }
    if (!streamed) {
      throw new MistralGatewayClientError(
        upstreamError
          ? `Your provider returned an error completion: ${upstreamError}`
          : "Your provider returned an invalid completion. Please retry shortly.",
        "invalid_response"
      );
    }
    return {
      text: streamed.text,
      toolCalls: streamed.toolCalls,
      model: model.modelId,
      usage: null,
      allowance: BYOK_ALLOWANCE,
    };
  }

  let buffered:
    | { text: string; toolCalls: GatewayToolCall[]; payload: Record<string, unknown> }
    | null = null;
  let bufferedUpstreamError: string | null = null;
  for (
    let attempt = 0;
    attempt <= EMPTY_COMPLETION_RETRIES && !buffered;
    attempt += 1
  ) {
    const response = await fetchChatCompletion();
    if (!response.ok) throw await byokHttpError(response);
    const payload = (await response.json().catch(() => ({}))) as
      | GatewayCompletion
      | Record<string, unknown>;
    const choice = (
      payload as {
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
      buffered = { text, toolCalls, payload: (payload ?? {}) as Record<string, unknown> };
      break;
    }
    bufferedUpstreamError =
      (payload as { error?: { message?: string } } | undefined)?.error?.message ??
      bufferedUpstreamError;
    describeEmptyCompletion([
      ...(bufferedUpstreamError ? [`error: ${bufferedUpstreamError}`] : []),
      ...(attempt < EMPTY_COMPLETION_RETRIES ? ["retrying"] : ["giving up"]),
    ]);
  }
  if (!buffered) {
    throw new MistralGatewayClientError(
      bufferedUpstreamError
        ? `Your provider returned an error completion: ${bufferedUpstreamError}`
        : "Your provider returned an invalid completion. Please retry shortly.",
      "invalid_response"
    );
  }
  return {
    text: buffered.text,
    toolCalls: buffered.toolCalls,
    model:
      (buffered.payload as { model?: string } | undefined)?.model ??
      model.modelId,
    usage:
      (buffered.payload as { usage?: GatewayCompletion["usage"] } | undefined)
        ?.usage ?? null,
    allowance: BYOK_ALLOWANCE,
  };
}

async function byokHttpError(response: Response) {
  const payload = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string } }
    | undefined;
  const message = payload?.error?.message;
  return new MistralGatewayClientError(
    (message ?? `Your provider rejected the request (HTTP ${response.status}).`).slice(0, 1200),
    classifyGatewayHttpError(response.status)
  );
}

/** Single-prompt completion against the user's own provider. */
export async function completeWithCustomModel(
  model: CustomModel,
  prompt: string,
  onChunk?: (chunk: string) => void
) {
  const result = await chatWithCustomModel(
    model,
    [{ role: "user", content: prompt }],
    onChunk ? { onChunk } : {}
  );
  return {
    text: result.text,
    model: result.model,
    usage: result.usage,
    allowance: result.allowance,
  };
}

/** The workspace's active custom model, or null when the built-in gateway is in use. */
export async function getActiveCustomModel(ownerId: number) {
  return getActiveCustomModelForUser(ownerId);
}

/**
 * Chat completions for the active workspace model: the user's own provider
 * when one is selected (BYOK), otherwise Nova's built-in Mistral gateway.
 */
export async function chatWithWorkspaceModel(
  ownerId: number,
  messages: GatewayChatMessage[],
  options: {
    tools?: GatewayToolDefinition[];
    model?: string;
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
  } = {}
): Promise<GatewayChatResult> {
  const custom = await getActiveCustomModel(ownerId);
  if (custom) {
    const { model: _requestedModel, ...customOptions } = options;
    return chatWithCustomModel(custom, messages, customOptions);
  }
  return chatWithMistralGateway(ownerId, messages, options);
}

/** Prompt completions for the active workspace model (BYOK or built-in gateway). */
export async function completeWithWorkspaceModel(
  ownerId: number,
  prompt: string,
  modelId?: string,
  onChunk?: (chunk: string) => void
) {
  const custom = await getActiveCustomModel(ownerId);
  if (custom) return completeWithCustomModel(custom, prompt, onChunk);
  return completeWithMistralGateway(ownerId, prompt, modelId, onChunk);
}

/**
 * Checks a candidate BYOK endpoint before the user saves it: a one-token
 * chat completion proves the base URL is reachable and the key is accepted.
 */
export async function testCustomModelEndpoint(input: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}): Promise<{ ok: boolean; message: string }> {
  const modelId = input.modelId.trim();
  if (!modelId) {
    throw new MistralGatewayClientError("Enter the model ID before testing the connection.", "configuration");
  }
  const response = await byokFetch(
    input.baseUrl,
    input.apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    },
    BYOK_TEST_TIMEOUT_MS
  );
  if (!response.ok) throw await byokHttpError(response);
  // A reachable endpoint is enough; an empty tiny completion is not an error.
  return { ok: true, message: "Connected. The provider accepted the request." };
}
