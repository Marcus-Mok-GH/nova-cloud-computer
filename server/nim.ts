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
  | { kind: "text"; text: string }
  | { kind: "tool_calls"; text: string; toolCalls: NimAgentToolCall[] };

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
function nimChatEndpoint(): URL {
  if (!isNimConfigured()) {
    throw new NimConfigError("NVIDIA NIM is not configured - set NVIDIA_NIM_API_KEY (or the legacy NVIDIA_API_KEY) to enable it.");
  }
  if (!ENV.nimCoderModel) {
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
async function postNimChat(
  body: Record<string, unknown>,
  timeoutMs: number,
  modelOverride?: string
): Promise<{ message?: { content?: unknown; tool_calls?: unknown } }> {
  const endpoint = nimChatEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.nimApiKey}`,
    },
    body: JSON.stringify({
      model: modelOverride ?? ENV.nimCoderModel,
      temperature: 0.2,
      ...body,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
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
    throw failure;
  }
  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown; tool_calls?: unknown } }[];
  } | null;
  return payload?.choices?.[0] ?? {};
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
    options.timeoutMs ?? 240_000
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
  if (toolCalls.length > 0) {
    return { kind: "tool_calls", text, toolCalls };
  }
  if (!text) {
    throw new Error("NVIDIA NIM finished without a reply.");
  }
  return { kind: "text", text };
}
