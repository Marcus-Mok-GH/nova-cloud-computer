export type TelegramBotProfile = { id: string; username: string | null; displayName: string | null };
type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

function telegramUrl(token: string, method: string) {
  return `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
}

async function telegramRequest<T>(token: string, method: string, payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetchImpl(telegramUrl(token, method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const data = await response.json().catch(() => ({})) as TelegramResponse<T>;
  if (!response.ok || !data.ok || data.result === undefined) throw new Error(data.description || "Telegram could not complete that request.");
  return data.result;
}

export async function validateTelegramBotToken(token: string, fetchImpl: typeof fetch = fetch): Promise<TelegramBotProfile> {
  const bot = await telegramRequest<{ id: number; username?: string; first_name?: string }>(token, "getMe", {}, fetchImpl);
  return { id: String(bot.id), username: bot.username ?? null, displayName: bot.first_name ?? null };
}

export async function discoverTelegramChat(token: string, fetchImpl: typeof fetch = fetch) {
  const updates = await telegramRequest<Array<{ message?: { chat?: { id?: number | string } }; channel_post?: { chat?: { id?: number | string } } }>>(token, "getUpdates", { limit: 50 }, fetchImpl);
  const chat = [...updates].reverse().map(update => update.message?.chat ?? update.channel_post?.chat).find(Boolean);
  if (!chat?.id) throw new Error("No chat has messaged this bot yet. Open Telegram, send /start to your bot, then try again.");
  return String(chat.id);
}

export async function sendTelegramMessage(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch) {
  return telegramRequest<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }, fetchImpl);
}

export async function setTelegramWebhook(token: string, webhookUrl: string, fetchImpl: typeof fetch = fetch) {
  return telegramRequest<{ result: boolean; description?: string }>(token, "setWebhook", { url: webhookUrl, allowed_updates: ["message", "channel_post"] }, fetchImpl);
}

type RawWebhookInfo = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  last_synchronization_error_message?: string;
  max_connections?: number;
  ip_address?: string;
  allowed_updates?: string[];
};

export type TelegramWebhookInfo = {
  url: string | null;
  hasCustomCertificate: boolean;
  pendingUpdateCount: number;
  lastErrorDate: number | null;
  lastErrorMessage: string | null;
  lastSynchronizationErrorDate: number | null;
  lastSynchronizationErrorMessage: string | null;
  maxConnections: number | null;
  ipAddress: string | null;
  allowedUpdates: string[] | null;
};

export async function getTelegramWebhookInfo(token: string, fetchImpl: typeof fetch = fetch): Promise<TelegramWebhookInfo> {
  const raw = await telegramRequest<RawWebhookInfo>(token, "getWebhookInfo", {}, fetchImpl);
  return {
    url: raw.url ?? null,
    hasCustomCertificate: raw.has_custom_certificate ?? false,
    pendingUpdateCount: raw.pending_update_count ?? 0,
    lastErrorDate: raw.last_error_date ?? null,
    lastErrorMessage: raw.last_error_message ?? null,
    lastSynchronizationErrorDate: raw.last_synchronization_error_date ?? null,
    lastSynchronizationErrorMessage: raw.last_synchronization_error_message ?? null,
    maxConnections: raw.max_connections ?? null,
    ipAddress: raw.ip_address ?? null,
    allowedUpdates: raw.allowed_updates ?? null,
  };
}