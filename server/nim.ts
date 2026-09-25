/** NVIDIA NIM chat client for Nova's specialist sub-agents.
 *
 * NIM serves OpenAI-compatible chat completions from frontier open models
 * (https://build.nvidia.com): a personal key from build.nvidia.com unlocks
 * the hosted endpoint at https://integrate.api.nvidia.com/v1, and a
 * self-hosted NIM container speaks the same protocol, so the base URL is
 * overridable. The gateway behind Nova's own model is Mistral; specialist
 * delegates with different strengths (the coder, the researcher) live next
 * to it and call their providers directly through this small client. */

import { ENV } from "./_core/env";

/**
 * A deterministic configuration failure - a missing key, a missing model ID
 * for a custom endpoint, or a refused plaintext transport. Callers treat
 * these as non-retryable: no amount of retrying fixes a config problem.
 */
export class NimConfigError extends Error {}

/**
 * The endpoint rejected a request carrying `tools` (some NIM-served models
 * do not implement function calling). Callers fall back to plain chat.
 */
export class NimToolsUnsupportedError extends Error {}

export function isNimConfigured() {
  return ENV.nimApiKey.trim().length > 0;
}

/**
 * NIM-served models with a documented deep-reasoning parameter. Kimi K3 (the
 * default coder model) takes `reasoning_effort: "max"` in the OpenAI-style
 * payload (per NVIDIA's own kimi-k3 example); K2.5+ thinking models accept
 * the same field. Other NIM models (and self-hosted endpoints serving
 * anything else) get no extra fields, so a strict endpoint can never be
 * broken by an unknown parameter.
 */
const NIM_REASONING_MODEL_PATTERN = /kimi-k(3|[2-9]\.[5-9])/i;

/** Deep-reasoning request fields for models that support them, else {}. */
export function nimReasoningParamsForModel(modelId: string): Record<string, unknown> {
  return NIM_REASONING_MODEL_PATTERN.test(modelId)
    ? { reasoning_effort: "max" }
    : {};
}

export type NimChatOptions = {
  /** The task prompt for the model - complete and self-contained. */
  prompt: string;
  /** The system prompt steering the specialist's behavior and output shape. */
  systemPrompt: string;
  /** NIM model ID; defaults to the strongest coding model NIM serves. */
  model?: string;
  /** Cap on the generated tokens (default 8192). */
  maxTokens?: number;
  /** Hard client-side cap on the request (default 240s, Vercel-bound). */
  timeoutMs?: number;
};

export type NimAgentToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type NimAgentMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type NimAgentTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type NimAgentChatOptions = {
  /** The full conversation so far - system prompt, task, tool results. */
  messages: NimAgentMessage[];
  /** The callable tools for this turn. */
  tools: NimAgentTool[];
  /** NIM model ID; defaults to the strongest coding model NIM serves. */
  model?: string;
  /** Cap on the generated tokens (default 8192). */
  maxTokens?: number;
  /** Hard client-side cap on the request (default 240s, Vercel-bound). */
  timeoutMs?: number;
};

export type NimAgentReply =
  /** The reasoning text the model produced before its answer, when present. */
  | { kind: "text"; text: string; reasoning?: string }
  | { kind: "tool_calls"; text: string; toolCalls: NimAgentToolCall[]; reasoning?: string };

/** The final text, tolerating a string or OpenAI-style content part array. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
      .join("")
      .trim();
  }
  return "";
}

/** Shared endpoint/key/transport resolution for both chat variants. */
function nimChatEndpoint(modelOverride?: string): URL {
  if (!isNimConfigured()) {
    throw new NimConfigError("NVIDIA NIM is not configured - set NVIDIA_NIM_API_KEY (or the legacy NVIDIA_API_KEY) to enable it.");
  }
  if (!(modelOverride ?? ENV.nimCoderModel)) {
    throw new NimConfigError(
      "NVIDIA_NIM_CODER_MODEL is required when NVIDIA_NIM_API_URL points to a self-hosted or custom endpoint - set it to the model ID your NIM container serves (e.g. 'moonshotai/kimi-k3')."
    );
  }
  const endpoint = new URL(`${ENV.nimApiUrl.replace(/\/+$/, "")}/chat/completions`);
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    // The key travels in the Authorization header: refuse to send it over
    // an unencrypted transport to anything that is not this machine.
    throw new NimConfigError(
      `Refusing to send the NVIDIA NIM API key over ${endpoint.protocol}//${endpoint.hostname} - set NVIDIA_NIM_API_URL to an HTTPS endpoint (or http on a loopback host).`
    );
  }
  return endpoint;
}

/** One OpenAI-style chat completion. Returns the raw message object. */
/** HTTP statuses whose failure is usually momentary (overload, rate limit). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_NIM_ATTEMPTS = 4;
const MAX_RETRY_WAIT_MS = 90_000;
const RETRY_BACKOFF_MS = [1_000, 3_000, 8_000, 15_000];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Retry delay from a Retry-After header when present and sane. */
function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1_000, 60_000);
}

async function postNimChat(
  body: Record<string, unknown>,
  timeoutMs: number,
  modelOverride?: string
): Promise<{ message?: { content?: unknown; tool_calls?: unknown } }> {
  const endpoint = nimChatEndpoint(modelOverride);
  const model = modelOverride ?? ENV.nimCoderModel;
  // Rate limits and pool overloads are routine on the shared NIM fleet;
  // a specialist that exits on the first 429 fails otherwise-completable
  // tasks. Retry transient failures with backoff, and give a request that
  // timed out exactly one second chance (NIM stalls are often momentary,
  // while a genuinely too-long generation would just reproduce itself).
  let attempt = 0;
  let retryWaitTotalMs = 0;
  let timedOutOnce = false;
  while (true) {
    attempt += 1;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ENV.nimApiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          ...nimReasoningParamsForModel(model),
          ...body,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError" && !timedOutOnce) {
        timedOutOnce = true;
        continue;
      }
      if (attempt < MAX_NIM_ATTEMPTS && retryWaitTotalMs < MAX_RETRY_WAIT_MS) {
        const wait = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
        retryWaitTotalMs += wait;
        await sleep(wait);
        continue;
      }
      throw error;
    }
    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        choices?: { message?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown } }[];
      } | null;
      return payload?.choices?.[0] ?? {};
    }
    const detail = await response.text().catch(() => "");
    const hint = detail.slice(0, 300).replace(/\s+/g, " ").trim();
    const failure = new Error(
      `NVIDIA NIM responded with status ${response.status}${hint ? `: ${hint}` : "."}`
    );
    // Client-side rejections of the tools payload mean the served model
    // does not implement function calling - a distinct, recoverable case.
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      throw new NimToolsUnsupportedError(failure.message);
    }
    if (!RETRYABLE_STATUS.has(response.status) || attempt >= MAX_NIM_ATTEMPTS || retryWaitTotalMs >= MAX_RETRY_WAIT_MS) {
      throw failure;
    }
    const wait = retryAfterMs(response) ?? RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
    retryWaitTotalMs += wait;
    await sleep(wait);
  }
}

/** The model's private reasoning text, when the endpoint returns one. */
function extractReasoning(message: {
  content?: unknown;
  tool_calls?: unknown;
  reasoning_content?: unknown;
}): string {
  return typeof message.reasoning_content === "string"
    ? message.reasoning_content.trim()
    : "";
}

/**
 * Runs one NVIDIA NIM chat completion to completion and returns the model's
 * text. Rejects when the key is missing, the request fails, or the model
 * returns no text.
 */
export async function runNimChat(options: NimChatOptions): Promise<string> {
  try {
    const message = await postNimChat(
      {
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.prompt },
        ],
        max_tokens: options.maxTokens ?? 8192,
      },
      options.timeoutMs ?? 240_000,
      options.model
    );
    const text = extractText(message.message?.content);
    if (!text) {
      throw new Error("NVIDIA NIM finished without a reply.");
    }
    return text;
  } catch (error) {
    // A plain chat never sends tools, so tools rejection is impossible;
    // unwrap that class into a generic failure for stable caller semantics.
    if (error instanceof NimToolsUnsupportedError) throw new Error(error.message);
    throw error;
  }
}

/**
 * One agentic turn for tool-calling specialists: sends the conversation and
 * tools and returns either the model's text or the tool calls it requested.
 * Throws NimToolsUnsupportedError when the endpoint rejects the tools
 * payload, so callers can fall back to plain chat.
 */
export async function runNimAgentChat(
  options: NimAgentChatOptions
): Promise<NimAgentReply> {
  const message = await postNimChat(
    {
      messages: options.messages,
      tools: options.tools,
      tool_choice: "auto",
      max_tokens: options.maxTokens ?? 8192,
    },
    options.timeoutMs ?? 240_000,
    options.model
  );
  const rawToolCalls = Array.isArray(message.message?.tool_calls)
    ? (message.message?.tool_calls as unknown[])
    : [];
  const toolCalls: NimAgentToolCall[] = [];
  for (const raw of rawToolCalls) {
    const call =
      raw && typeof raw === "object"
        ? (raw as {
            id?: unknown;
            function?: { name?: unknown; arguments?: unknown };
          })
        : null;
    const id = typeof call?.id === "string" ? call.id : "";
    const name =
      typeof call?.function?.name === "string" ? call.function.name : "";
    const args =
      typeof call?.function?.arguments === "string"
        ? call.function.arguments
        : "{}";
    if (id && name) toolCalls.push({ id, name, arguments: args });
  }
  const text = extractText(message.message?.content);
  const reasoning = extractReasoning(message.message ?? {});
  if (toolCalls.length > 0) {
    return { kind: "tool_calls", text, toolCalls, ...(reasoning ? { reasoning } : {}) };
  }
  if (!text) {
    throw new Error("NVIDIA NIM finished without a reply.");
  }
  return { kind: "text", text, ...(reasoning ? { reasoning } : {}) };
}
