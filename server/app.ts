import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { runAutomationForScheduleTask } from "./automations";
import {
  findWorkspaceOwnerByTelegramToken,
  getTelegramCredentialsForUser,
  deleteChatForUser,
  listChatsForUser,
  updateTelegramChatForUser,
  createChatForUser,
} from "./db";
import { runWorkspaceAgent, autoTitleChatForUser } from "./workspaceAgent";
import { ENV } from "./_core/env";
import { sendTelegramMessage } from "./telegram";

// Max Telegram chats per workspace to prevent unbounded DB growth.
const MAX_TELEGRAM_CHATS = 100;

/** Prune oldest chats if user exceeds MAX_TELEGRAM_CHATS. */
async function pruneChatsIfNeeded(ownerId: number): Promise<void> {
  const chats = await listChatsForUser(ownerId);
  if (chats.length > MAX_TELEGRAM_CHATS) {
    const toDelete = chats.slice(MAX_TELEGRAM_CHATS);
    await Promise.all(toDelete.map(c => deleteChatForUser(ownerId, c.id)));
    console.info(`[Telegram webhook] pruned ${toDelete.length} stale chats for owner ${ownerId}`);
  }
}

export const app = express();

// Defense-in-depth HTTP policy: workspace/API responses are private and must not be
// embedded, cached, sniffed, or exposed through a permissive cross-origin policy.
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

app.post("/api/scheduled/automation", async (req: express.Request, res: express.Response) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const outcome = await runAutomationForScheduleTask(user.taskUid);
    if (!outcome) return res.status(200).json({ ok: true, skipped: "orphaned-schedule" });
    if (outcome.failed > 0) throw new Error("The scheduled automation recorded a failed run and will be retried.");
    return res.status(200).json({ ok: true, outcome });
  } catch (error) {
    console.error("[Automation schedule] Callback failed", error);
    return res.status(500).json({ error: "automation-callback-failed", timestamp: new Date().toISOString(), context: { path: req.path } });
  }
});

app.post("/api/chat/delete", async (req: express.Request, res: express.Response) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const chatId = Number(req.body?.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) return res.status(400).json({ error: "Missing or invalid chatId" });
    const deleted = await deleteChatForUser(user.id, chatId);
    if (!deleted) return res.status(404).json({ error: "Chat not found" });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Chat delete endpoint error", error);
    return res.status(500).json({ error: "Nova could not delete this conversation." });
  }
});

app.post("/api/chat/stream", async (req: express.Request, res: express.Response) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { chatId, content } = req.body ?? {};
    if (!chatId || typeof content !== "string" || !content.trim()) return res.status(400).json({ error: "Missing chatId or content" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const writeEvent = (event: unknown) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };
    const result = await runWorkspaceAgent(user.id, Number(chatId), content.trim(), { onEvent: event => writeEvent(event) });
    const reply = String(result.message?.content ?? "I’m ready to help with this workspace.");
    writeEvent({ choices: [{ delta: { content: reply } }] });
    await autoTitleChatForUser(user.id, Number(chatId));
    res.write("data: [DONE]\n\n");
    return res.end();
  } catch (error) {
    console.error("Chat stream endpoint error", error);
    if (!res.headersSent) return res.status(500).json({ error: "Nova could not start this response. Please retry shortly." });
    return res.end();
  }
});

async function handleTelegramUpdate(token: string, req: express.Request, res: express.Response): Promise<boolean> {
  try {
    const update = req.body;
    const message = update.message ?? update.channel_post;
    if (!message?.text) { res.status(200).json({ ok: true, skipped: "no-text" }); return true; }
    const chatId = String(message.chat.id);
    const text = String(message.text).trim();
    if (!text) { res.status(200).json({ ok: true, skipped: "empty-text" }); return true; }
    const ownerId = await findWorkspaceOwnerByTelegramToken(token, chatId);
    if (!ownerId) {
      const isDefaultBot = Boolean(ENV.defaultTelegramBotToken && token === ENV.defaultTelegramBotToken);
      if (isDefaultBot) {
        const linkUrl = `https://nova-cloud-computer.vercel.app`;
        await sendTelegramMessage(token, chatId, `This Telegram chat is not yet linked to a Nova workspace. Open ${linkUrl} and use the Telegram link button (sends /start with nova_app_link) to link your account. Then send your message again.`);
        res.status(200).json({ ok: true, skipped: "unlinked-shared-bot" });
      } else {
        res.status(404).json({ error: "bot-not-configured", debug: { isDefaultTok: ENV.defaultTelegramBotToken.length, tokenEq: token === ENV.defaultTelegramBotToken } });
      }
      return true;
    }
    const isAppLink = text.toLowerCase().includes("nova_app_link");
    if (isAppLink) {
      void updateTelegramChatForUser(ownerId, chatId).catch(() => {});
    } else {
      const current = await getTelegramCredentialsForUser(ownerId).catch(() => undefined);
      if (!current?.chatId || current.chatId === chatId) {
        void updateTelegramChatForUser(ownerId, chatId).catch(() => {});
      }
    }
    if (text === "/start" || text.toLowerCase() === "start" || text.toLowerCase().startsWith("/start ")) {
      const startMessage = "👋 Welcome to Nova Cloud Computer!\n\n" + "I'm your AI assistant inside this workspace. You can ask me to:\n" + "• Create, rename, move, or delete files\n" + "• Run a VM or sandbox when you ask\n" + "• Send Telegram messages on your behalf\n\n" + (isAppLink ? "✅ This chat is now linked to your Nova workspace. Just send me a message to get started." : "Just send me a message to get started.");
      await sendTelegramMessage(token, chatId, startMessage);
      res.status(200).json({ ok: true, replied: "start", linked: isAppLink });
      return true;
    }
    if (text === "/new") {
      const chat = await createChatForUser(ownerId, "Telegram Chat");
      void pruneChatsIfNeeded(ownerId);
      const reply = `New chat created (ID: ${chat.id}). Ask me anything!`;
      await sendTelegramMessage(token, chatId, reply);
      res.status(200).json({ ok: true });
      return true;
    }
    const chat = await createChatForUser(ownerId, "Telegram Chat");
    void pruneChatsIfNeeded(ownerId);
    const result = await runWorkspaceAgent(ownerId, chat.id, text);
    const reply = String(result.message?.content ?? "I'm ready to help with this workspace.");
    await sendTelegramMessage(token, chatId, reply);
    await autoTitleChatForUser(ownerId, chat.id);
    res.status(200).json({ ok: true });
    return true;
  } catch (error) {
    console.error("[Telegram webhook] failed", error);
    res.status(500).json({ error: "webhook-failed" });
    return true;
  }
}

app.post("/api/telegram/webhook/:token", async (req, res) => {
  const token = req.params.token;
  if (!token) return res.status(400).json({ error: "missing-token" });
  await handleTelegramUpdate(token, req, res);
});

// Default (shared) bot uses a fixed path without the token to avoid breaking
// on Vercel rewrites and the colon in the numeric API token.
app.post("/api/telegram/webhook/default", async (req, res) => {
  const token = ENV.defaultTelegramBotToken;
  const raw = process.env.DEFAULT_TELEGRAM_BOT_TOKEN ?? "";
  if (!token) {
    return res.status(404).json({
      error: "bot-not-configured-empty-token",
      debug: { envSet: Boolean(raw), envLen: raw.length, nodeEnv: process.env.NODE_ENV },
    });
  }
  res.setHeader("x-telegram-token-len", String(token.length));
  await handleTelegramUpdate(token, req, res);
});

app.get("/api/health", (_req: express.Request, res: express.Response) => res.status(200).json({ ok: true, service: "nova" }));
