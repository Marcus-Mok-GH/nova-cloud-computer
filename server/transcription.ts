/** Nova's voice-message transcription.
 *
 * Telegram voice notes (and audio files) arrive as OGG/Opus uploads. The
 * webhook transcribes them with an OpenAI-compatible /audio/transcriptions
 * endpoint (OpenAI, Groq, and other compatible providers all speak it) so
 * the agent can act on what was said, Manus-style — the transcription
 * becomes the user's turn. The provider is env-configured:
 * TRANSCRIPTION_API_KEY (required), TRANSCRIPTION_API_BASE_URL (default
 * https://api.openai.com/v1 — set to e.g. https://api.groq.com/openai/v1
 * for Groq), and TRANSCRIPTION_MODEL (default whisper-1). */

import { ENV } from "./_core/env";

export function isTranscriptionConfigured() {
  return ENV.transcriptionApiKey.length > 0;
}

/** Transcribes audio bytes to text. Returns null when transcription is not
 * configured; throws with a clear message when the provider fails. */
export async function transcribeAudio(
  bytes: Buffer,
  mimeType: string,
  fileName: string
): Promise<string | null> {
  if (!isTranscriptionConfigured()) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType || "audio/ogg" }), fileName || "voice.ogg");
  form.append("model", ENV.transcriptionModel);
  const response = await fetch(`${ENV.transcriptionApiBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${ENV.transcriptionApiKey}` },
    body: form,
  });
  const data = await response.json().catch(() => ({})) as { text?: unknown; error?: { message?: unknown } | string };
  if (!response.ok) {
    const detail = typeof data.error === "string" ? data.error : typeof data.error?.message === "string" ? data.error.message : `HTTP ${response.status}`;
    throw new Error(`The transcription provider rejected the audio: ${detail}`);
  }
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) throw new Error("The transcription provider returned no text for that voice message.");
  return text;
}
