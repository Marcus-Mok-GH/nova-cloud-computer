export type TelegramBotProfile = { id: string; username: string | null; displayName: string | null };
export type TelegramWebhookInfo = { url: string | null; linked: boolean; pendingUpdateCount: number };
type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

function telegramUrl(token: string, method: string) {
  return `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
}

/** Bot API calls must never hang the webhook: a stalled Telegram request used
 * to freeze a background task until Vercel killed it at maxDuration, losing
 * the reply. Thirty seconds is far beyond any normal API response. */
const TELEGRAM_API_TIMEOUT_MS = 30_000;
/** File downloads carry the audio bytes, so they get a more generous cap. */
const TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS = 60_000;
/** Presenting a file to the chat uploads its bytes, so same generous cap. */
const TELEGRAM_FILE_PRESENT_TIMEOUT_MS = 60_000;

async function telegramRequest<T>(token: string, method: string, payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(telegramUrl(token, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
  }).catch(error => {
    throw new Error(error instanceof Error && /abort|time[d]?[\s-]?out/i.test(error.message) ? "Telegram did not answer in time." : error instanceof Error ? error.message : String(error));
  });
  const data = await response.json().catch(() => ({})) as TelegramResponse<T>;
  if (!response.ok || !data.ok || data.result === undefined) throw new Error(data.description || "Telegram could not complete that request.");
  return data.result;
}

export async function validateTelegramBotToken(token: string, fetchImpl: typeof fetch = fetch): Promise<TelegramBotProfile> {
  const bot = await telegramRequest<{ id: number; username?: string; first_name?: string }>(token, "getMe", {}, fetchImpl);
  return { id: String(bot.id), username: bot.username ?? null, displayName: bot.first_name ?? null };
}

/** Register Telegram's HTTPS callback so incoming messages reach Nova. */
export async function configureTelegramWebhook(token: string, appUrl: string, fetchImpl: typeof fetch = fetch) {
  let baseUrl: URL;
  try {
    baseUrl = new URL(appUrl);
  } catch {
    throw new Error("Nova could not determine its public HTTPS URL for Telegram.");
  }
  if (baseUrl.protocol !== "https:") {
    throw new Error("Telegram requires Nova to have a public HTTPS URL. Configure PUBLIC_APP_URL when deploying Nova.");
  }
  if (token === process.env.DEFAULT_TELEGRAM_BOT_TOKEN) {
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/api/telegram/webhook/default`;
  } else {
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/api/telegram/webhook/${encodeURIComponent(token)}`;
  }
  baseUrl.search = "";
  baseUrl.hash = "";
  await telegramRequest<boolean>(token, "setWebhook", { url: baseUrl.toString() }, fetchImpl);
  return { webhookUrl: baseUrl.toString() };
}

/** Query Telegram's registered callback; linked=false signals a recovery action is needed. */
export async function getTelegramWebhookInfo(token: string, fetchImpl: typeof fetch = fetch): Promise<TelegramWebhookInfo> {
  const info = await telegramRequest<{ url?: string; pending_update_count?: number }>(token, "getWebhookInfo", {}, fetchImpl);
  return { url: info.url ?? null, linked: Boolean(info.url), pendingUpdateCount: info.pending_update_count ?? 0 };
}

export async function discoverTelegramChat(token: string, fetchImpl: typeof fetch = fetch) {
  let updates: Array<{ message?: { chat?: { id?: number | string } }; channel_post?: { chat?: { id?: number | string } } }>;
  try {
    updates = await telegramRequest<Array<{ message?: { chat?: { id?: number | string } }; channel_post?: { chat?: { id?: number | string } } }>>(token, "getUpdates", { limit: 50 }, fetchImpl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("webhook") && msg.toLowerCase().includes("getupdates")) {
      await telegramRequest<boolean>(token, "deleteWebhook", { drop_pending_updates: false }, fetchImpl);
      updates = await telegramRequest<Array<{ message?: { chat?: { id?: number | string } }; channel_post?: { chat?: { id?: number | string } } }>>(token, "getUpdates", { limit: 50 }, fetchImpl);
    } else {
      throw err;
    }
  }
  const chat = [...updates].reverse().map(update => update.message?.chat ?? update.channel_post?.chat).find(Boolean);
  if (!chat?.id) throw new Error("No chat has messaged this bot yet. Open Telegram, send /start to your bot, then try again.");
  return String(chat.id);
}

/**
 * Telegram messages are sent without a parse mode, so raw markdown emphasis
 * would reach the user as literal asterisks and underscores ("**under a
 * minute**" instead of an emphasised "under a minute"). Underscore pairs are
 * left alone deliberately: file names and identifiers use single underscores.
 */
export function stripMarkdownEmphasis(text: string) {
  let result = text;
  while (true) {
    const stripped = result
      .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, "$1")
      .replace(/__(\S(?:[^_\n]*\S)?)__/g, "$1")
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)(?!\w)/g, "$1$2");
    if (stripped === result) return result;
    result = stripped;
  }
}

/**
 * Sends a plain-text Telegram message. Emphasis markers are stripped first
 * because no parse mode is set: Telegram would otherwise render them as
 * literal asterisks and underscores. Throws the Telegram error description
 * on failure so callers can surface the real cause.
 */
export async function sendTelegramMessage(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch, options?: { inlineKeyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>> }) {
  return telegramRequest<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text: stripMarkdownEmphasis(text),
    disable_web_page_preview: true,
    ...(options?.inlineKeyboard ? { reply_markup: { inline_keyboard: options.inlineKeyboard } } : {}),
  }, fetchImpl);
}

/** A file a Telegram user sent the bot: photos, documents, voice notes, media - any upload. */
export type TelegramUpload = {
  kind: "photo" | "document" | "voice" | "audio" | "video" | "video_note" | "sticker";
  fileId: string;
  fileName: string | null;
  mimeType: string | null;
};

/** Pull the uploaded file out of a Telegram message, if it carries one. Photos use the largest size. */
export function telegramUploadFromMessage(message: Record<string, unknown>): TelegramUpload | undefined {
  const photo = Array.isArray((message as { photo?: unknown }).photo)
    ? [...((message as { photo: Array<{ file_id?: unknown; file_size?: number }> }).photo)].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0]
    : undefined;
  if (photo?.file_id) return { kind: "photo", fileId: String(photo.file_id), fileName: null, mimeType: "image/jpeg" };
  const sources: Array<TelegramUpload["kind"]> = ["document", "voice", "audio", "video", "video_note", "sticker"];
  for (const kind of sources) {
    const media = (message as Record<string, Record<string, unknown>>)[kind];
    if (!media || typeof media.file_id !== "string") continue;
    const mimeType =
      kind === "sticker" && typeof media.mime_type !== "string" ? "image/webp" :
      typeof media.mime_type === "string" ? media.mime_type :
      kind === "voice" ? "audio/ogg" :
      kind === "video" || kind === "video_note" ? "video/mp4" : null;
    return {
      kind,
      fileId: media.file_id,
      fileName: typeof media.file_name === "string" ? media.file_name : null,
      mimeType,
    };
  }
  return undefined;
}

const TEXT_FILE_EXTENSIONS = /\.(txt|md|markdown|csv|json|ya?ml|toml|xml|html?|css|m?js|jsx|ts|tsx|py|rb|rs|go|java|kt|c|cc|cpp|h|hpp|sh|sql|ini|log|svg|env)$/i;
const TEXT_MIME_TYPES = new Set(["application/json", "application/xml", "application/javascript", "application/x-yaml", "application/yaml", "application/toml", "image/svg+xml", "application/x-sh", "application/sql"]);

function isTextFile(name: string, mimeType: string) {
  return mimeType.startsWith("text/") || TEXT_FILE_EXTENSIONS.test(name) || TEXT_MIME_TYPES.has(mimeType);
}

function telegramFileUrl(token: string, filePath: string) {
  return `https://api.telegram.org/file/bot${encodeURIComponent(token)}/${filePath}`;
}

/** Download an uploaded Telegram file and shape it into a workspace file payload: text stays readable, binary becomes a data URI. */
export async function downloadTelegramUpload(token: string, upload: TelegramUpload, fetchImpl: typeof fetch = fetch): Promise<{ name: string; content: string; mimeType: string }> {
  const fileInfo = await telegramRequest<{ file_path?: string }>(token, "getFile", { file_id: upload.fileId }, fetchImpl);
  if (!fileInfo.file_path) throw new Error("Telegram did not return a download path for that file.");
  const response = await fetchImpl(telegramFileUrl(token, fileInfo.file_path), { signal: AbortSignal.timeout(TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error("Telegram could not deliver that file.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const name =
    upload.fileName ??
    (upload.kind === "photo" ? `photo-${stamp}.jpg`
      : upload.kind === "voice" ? `voice-${stamp}.ogg`
      : upload.kind === "video" ? `video-${stamp}.mp4`
      : upload.kind === "video_note" ? `video-note-${stamp}.mp4`
      : upload.kind === "sticker" ? `sticker-${stamp}.webp`
      : `file-${stamp}`);
  const mimeType = upload.mimeType ?? "application/octet-stream";
  if (isTextFile(name, mimeType)) return { name, content: new TextDecoder().decode(bytes), mimeType };
  return { name, content: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`, mimeType };
}

/** Telegram file presentation: images arrive inline for viewing, everything else as a downloadable document. */
export async function presentTelegramFile(
  token: string,
  chatId: string,
  file: { name: string; content: string; mimeType?: string | null },
  caption?: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ messageId: number; as: "photo" | "document" }> {
  const mime = (file.mimeType ?? "").toLowerCase();
  const content = file.content ?? "";
  const boundedCaption = caption ? caption.slice(0, 1024) : undefined;

  const upload = async (method: "sendPhoto" | "sendDocument", part: "photo" | "document", blob: Blob) => {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (boundedCaption) form.append("caption", boundedCaption);
    form.append(part, blob, file.name);
    const response = await fetchImpl(telegramUrl(token, method), { method: "POST", body: form, signal: AbortSignal.timeout(TELEGRAM_FILE_PRESENT_TIMEOUT_MS) });
    const data = await response.json().catch(() => ({})) as TelegramResponse<{ message_id: number }>;
    if (!response.ok || !data.ok || data.result === undefined)
      throw new Error(data.description || "Telegram could not complete that request.");
    return data.result.message_id;
  };

  if (mime.startsWith("image/")) {
    // Inline data URI → decoded bytes, shown right in the chat.
    const dataUri = content.match(/^data:([^;]+);base64,([\s\S]*)$/);
    if (dataUri) {
      const bytes = Buffer.from(dataUri[2], "base64");
      return { messageId: await upload("sendPhoto", "photo", new Blob([new Uint8Array(bytes)], { type: dataUri[1] })), as: "photo" };
    }
    // Hosted image URL → Telegram fetches it itself.
    if (/^https?:\/\//i.test(content.trim())) {
      const response = await fetchImpl(telegramUrl(token, "sendPhoto"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, photo: content.trim(), ...(boundedCaption ? { caption: boundedCaption } : {}) }),
        signal: AbortSignal.timeout(TELEGRAM_FILE_PRESENT_TIMEOUT_MS),
      });
      const data = await response.json().catch(() => ({})) as TelegramResponse<{ message_id: number }>;
      if (!response.ok || !data.ok || data.result === undefined)
        throw new Error(data.description || "Telegram could not complete that request.");
      return { messageId: data.result.message_id, as: "photo" };
    }
    // Bare base64 bytes → decode and show inline; fall back to a document if it is not valid base64.
    if (content.trim()) {
      const bytes = Buffer.from(content, "base64");
      if (bytes.length > 0 && bytes.toString("base64").replace(/=+$/, "") === content.replace(/\s/g, "").replace(/=+$/, "")) {
        return { messageId: await upload("sendPhoto", "photo", new Blob([new Uint8Array(bytes)], { type: mime })), as: "photo" };
      }
    }
  }
  return { messageId: await upload("sendDocument", "document", new Blob([content], { type: mime || "text/plain" })), as: "document" };
}

export async function answerTelegramCallbackQuery(token: string, callbackQueryId: string, text?: string, fetchImpl: typeof fetch = fetch) {
  return telegramRequest<boolean>(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  }, fetchImpl);
}

/** Sends a Telegram typing action to indicate the bot is processing a message. */
export async function sendChatAction(token: string, chatId: string, action: "typing" | "choose_photo" | "upload_photo" | "choose_video" | "upload_video" | "choose_document" | "upload_document" | "find_location", fetchImpl: typeof fetch = fetch) {
  return telegramRequest<boolean>(token, "sendChatAction", {
    chat_id: chatId,
    action,
  }, fetchImpl);
}

export async function editTelegramMessage(token: string, chatId: string, messageId: number, text: string, fetchImpl: typeof fetch = fetch) {
  return telegramRequest<{ message_id: number }>(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  }, fetchImpl);
}
