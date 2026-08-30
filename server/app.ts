import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { runAutomationForScheduleTask } from "./automations";
import {
  findWorkspaceOwnerByTelegramToken,
  deleteChatForUser,
  listChatsForUser,
  updateTelegramChatForUser,
  createChatForUser,
} from "./db";
import { runWorkspaceAgent, autoTitleChatForUser } from "./workspaceAgent";
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

app.post("/api/telegram/webhook/:token", async (req: express.Request, res: express.Response) => {
  try {
    const token = req.params.token;
    if (!token) return res.status(400).json({ error: "missing-token" });
    const update = req.body;
    const message = update.message ?? update.channel_post;
    if (!message?.text) return res.status(200).json({ ok: true, skipped: "no-text" });
    const chatId = String(message.chat.id);
    const text = message.text.trim();
    if (!text) return res.status(200).json({ ok: true, skipped: "empty-text" });
    const ownerId = await findWorkspaceOwnerByTelegramToken(token);
    if (!ownerId) return res.status(404).json({ error: "bot-not-configured" });
    // Auto-link the chatting chat (idempotent; also materializes the default bot's settings row).
    void updateTelegramChatForUser(ownerId, chatId);
    if (text === "/start" || text.toLowerCase() === "start" || text.toLowerCase().startsWith("/start ")) {
      const isAppLink = text.toLowerCase().includes("nova_app_link") || text.toLowerCase().startsWith("/start nova_app_link");
      const startMessage = "👋 Welcome to Nova Cloud Computer!\n\n" + "I'm your AI assistant inside this workspace. You can ask me to:\n" + "• Create, rename, move, or delete files\n" + "• Run a VM or sandbox when you ask\n" + "• Send Telegram messages on your behalf\n\n" + (isAppLink ? "✅ This chat is now linked to your Nova workspace. Just send me a message to get started." : "Just send me a message to get started.");
      await sendTelegramMessage(token, chatId, startMessage);
      return res.status(200).json({ ok: true, replied: "start", linked: isAppLink });
    }
    if (text === "/new") {
      const chat = await createChatForUser(ownerId, "Telegram Chat");
      void pruneChatsIfNeeded(ownerId);
      const reply = `New chat created (ID: ${chat.id}). Ask me anything!`;
      await sendTelegramMessage(token, chatId, reply);
      return res.status(200).json({ ok: true });
    }
    const chat = await createChatForUser(ownerId, "Telegram Chat");
    void pruneChatsIfNeeded(ownerId);
    const result = await runWorkspaceAgent(ownerId, chat.id, text);
    const reply = String(result.message?.content ?? "I'm ready to help with this workspace.");
    await sendTelegramMessage(token, chatId, reply);
    await autoTitleChatForUser(ownerId, chat.id);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[Telegram webhook] failed", error);
    return res.status(500).json({ error: "webhook-failed" });
  }
});

app.get("/api/health", (_req: express.Request, res: express.Response) => res.status(200).json({ ok: true, service: "nova" }));
