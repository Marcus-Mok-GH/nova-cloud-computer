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

/**
 * Runs one NVIDIA NIM chat completion to completion and returns the model's
 * text. Rejects when the key is missing, the request fails, or the model
 * returns no text.
 */
export async function runNimChat(options: NimChatOptions): Promise<string> {
  if (!isNimConfigured()) {
    throw new Error("NVIDIA NIM is not configured - set NVIDIA_NIM_API_KEY (or the legacy NVIDIA_API_KEY) to enable it.");
  }
  const model = options.model ?? ENV.nimCoderModel;
  if (!model) {
    throw new Error(
      "NVIDIA_NIM_CODER_MODEL is required when NVIDIA_NIM_API_URL points to a self-hosted or custom endpoint - set it to the model ID your NIM container serves (e.g. 'moonshotai/kimi-k3')."
    );
  }
  const endpoint = new URL(`${ENV.nimApiUrl.replace(/\/+$/, "")}/chat/completions`);
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    // The key travels in the Authorization header: refuse to send it over
    // an unencrypted transport to anything that is not this machine.
    throw new Error(
      `Refusing to send the NVIDIA NIM API key over ${endpoint.protocol}//${endpoint.hostname} - set NVIDIA_NIM_API_URL to an HTTPS endpoint (or http on a loopback host).`
    );
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.nimApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.prompt },
      ],
      max_tokens: options.maxTokens ?? 8192,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 240_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const hint = detail.slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(`NVIDIA NIM responded with status ${response.status}${hint ? `: ${hint}` : "."}`);
  }
  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
  } | null;
  const text = extractText(payload?.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error("NVIDIA NIM finished without a reply.");
  }
  return text;
}
