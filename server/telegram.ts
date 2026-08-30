export type TelegramBotProfile = { id: string; username: string | null; displayName: string | null };
export type TelegramWebhookInfo = { url: string | null; linked: boolean; pendingUpdateCount: number };
type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

function telegramUrl(token: string, method: string) {
  return `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
}

async function telegramRequest<T>(token: string, method: string, payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(telegramUrl(token, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
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
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/api/telegram/webhook/${encodeURIComponent(token)}`;
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

export async function sendTelegramMessage(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch) {
  return telegramRequest<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }, fetchImpl);
}
