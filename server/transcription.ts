/** Nova's voice-message transcription.
 *
 * Telegram voice notes (and audio files) arrive as OGG/Opus uploads. The
 * webhook transcribes them with an OpenAI-compatible /audio/transcriptions
 * endpoint so the agent can act on what was said, Manus-style - the
 * transcription becomes the user's turn. The default provider is the
 * Pollinations AI unified API (https://gen.pollinations.ai), whose
 * /v1/audio/transcriptions endpoint is Whisper-compatible - activated by
 * setting POLLINATIONS_API_KEY. A legacy TRANSCRIPTION_API_KEY (in existing
 * deployments an OpenAI credential) keeps the former OpenAI defaults so that
 * key is never sent to Pollinations. Any OpenAI-compatible provider (OpenAI,
 * Groq, ...) still works by setting TRANSCRIPTION_API_BASE_URL (and optionally
 * TRANSCRIPTION_MODEL). See resolveTranscriptionConfig in server/_core/env.
 *
 * Pollinations' transcription endpoint documents only mp3, mp4, mpeg, mpga,
 * m4a, wav and webm - Telegram voice notes are OGG/Opus. When the target
 * provider is Pollinations, OGG audio is decoded in-process (WASM) and
 * repackaged as 16-bit mono WAV at this boundary before upload. */

import { ENV } from "./_core/env";
import { OggOpusDecoder } from "ogg-opus-decoder";

/** Telegram voice notes are OGG/Opus; the Pollinations transcription endpoint does not document OGG. */
const POLLINATIONS_TRANSCRIPTION_HOST = "gen.pollinations.ai";

function isOggAudio(mimeType: string, fileName: string): boolean {
  const m = (mimeType || "").toLowerCase();
  const n = (fileName || "").toLowerCase();
  return m.includes("ogg") || n.endsWith(".ogg") || n.endsWith(".oga") || n.endsWith(".opus");
}

/** Wraps 16-bit mono PCM in a 44-byte RIFF/WAV header. */
function pcmToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataBytes = pcm.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(pcm[i], 44 + i * 2);
  return wav;
}

/** Decodes OGG/Opus audio (Telegram voice notes) to a WAV buffer, mixing down to 16-bit mono. */
export async function oggOpusToWav(bytes: Buffer): Promise<Buffer> {
  const decoder = new OggOpusDecoder();
  try {
    const out = await decoder.decodeFile(new Uint8Array(bytes));
    const channels = out.channelData ?? [];
    const samples = out.samplesDecoded;
    if (!channels.length || !(samples > 0)) throw new Error("the voice note could not be decoded (no OGG/Opus audio frames found)");
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      let value = channels[0][i];
      if (channels.length > 1) {
        let sum = 0;
        for (const channel of channels) sum += channel[i];
        value = sum / channels.length;
      }
      pcm[i] = Math.max(-1, Math.min(1, value)) * 32767;
    }
    return pcmToWav(pcm, out.sampleRate);
  } finally {
    decoder.free();
  }
}

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
  // Pollinations does not document OGG support, so Telegram's OGG/Opus voice notes are
  // repackaged as WAV (a format every OpenAI-compatible provider accepts) before upload.
  let payload = bytes;
  let uploadMimeType = mimeType || "audio/ogg";
  let uploadFileName = fileName || "voice.ogg";
  if (ENV.transcriptionApiBaseUrl.includes(POLLINATIONS_TRANSCRIPTION_HOST) && isOggAudio(mimeType, fileName)) {
    payload = await oggOpusToWav(bytes);
    uploadMimeType = "audio/wav";
    uploadFileName = uploadFileName.replace(/\.(ogg|oga|opus)$/i, ".wav");
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(payload)], { type: uploadMimeType }), uploadFileName);
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
