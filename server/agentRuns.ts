import { startAgentRunForUser, finishAgentRunForUser } from "./db";
import { autoTitleChatForUser, runWorkspaceAgent, sendTelegramWorkStartedAck, MAX_RUN_BUDGET_MS } from "./workspaceAgent";
import { sendChatAction, sendTelegramMessage } from "./telegram";
import { trackBackgroundWork } from "./backgroundWork";

/** The web app that renders each chat's full tool-activity replay. */
export const NOVA_WEB_APP_URL = "https://nova-cloud-computer.vercel.app";
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const VIEW_RUN_BUTTON_TEXT = "\u{1FA90} View this run in Nova";

export interface ExecuteTelegramRunInput {
  ownerId: number;
  /** The workspace chat the run belongs to. */
  chatId: number;
  token: string;
  /** The Telegram chat id replies are delivered to. */
  telegramChatId: string;
  /** The clean user text, used for the model-written work-started ack. */
  agentText: string;
  /** Attachment context appended to the agent's turn but hidden from the ack. */
  uploadContext?: string;
  imageAttachments?: string[];
  requestStartedAtMs: number;
}

export interface ExecuteTelegramRunResult {
  delivered: boolean;
  reply: string;
  runId?: number;
}

/**
 * Runs one agent segment for a Telegram-triggered conversation and delivers
 * the final reply. Extracted from the webhook so a future continuation
 * endpoint can resume segmented runs through exactly the same path, while
 * the agent_runs ledger records the outcome for run listing.
 */
export async function executeTelegramAgentRun(input: ExecuteTelegramRunInput): Promise<ExecuteTelegramRunResult> {
  const { ownerId, chatId, token, telegramChatId, agentText, uploadContext, imageAttachments, requestStartedAtMs } = input;
  const deadlineAtMs = requestStartedAtMs + MAX_RUN_BUDGET_MS;
  // The ledger is best-effort: a database hiccup must never block the reply.
  const run = await startAgentRunForUser(ownerId, { chatId, notifyChatId: telegramChatId }).catch(() => undefined);
  let streamedText = "";
  /* No "Thinking..." placeholder: a placeholder became a permanent orphan bubble whenever its final edit failed, and streaming edits collided with Telegram's per-second edit limit during long runs. A typing action refreshed until the reply lands keeps the chat clean. */
  const typingTimer = setInterval(() => { void sendChatAction(token, telegramChatId, "typing").catch(() => {}); }, 4500);
  try {
    await sendChatAction(token, telegramChatId, "typing");
    // Guaranteed work-started confirmation, written by the model: the user must never sit in silence wondering whether Nova is working. Bounded internally; it never stalls the agent run by more than a few seconds.
    await sendTelegramWorkStartedAck(ownerId, token, telegramChatId, agentText, deadlineAtMs).catch(() => {});
    const result = await runWorkspaceAgent(ownerId, chatId, agentText + (uploadContext ?? ""), {
      channel: "telegram",
      imageAttachments,
      deadlineAtMs,
      onChunk: async (chunk: string) => { streamedText += chunk; },
    });
    const reply = String(result.message?.content ?? streamedText ?? "I'm ready to help with this workspace.").trim();
    if (!reply) {
      await sendTelegramMessage(token, telegramChatId, "Nova could not finish that reply. Please try again shortly.");
      if (run) await finishAgentRunForUser(ownerId, run.id, "failed", "the run produced an empty reply").catch(() => {});
      return { delivered: false, reply: "", runId: run?.id };
    }
    let delivered = false;
    const replyChunks = Math.max(1, Math.ceil(reply.length / TELEGRAM_MESSAGE_LIMIT));
    for (let chunk = 0; chunk < replyChunks; chunk++) {
      const offset = chunk * TELEGRAM_MESSAGE_LIMIT;
      try {
        await sendTelegramMessage(token, telegramChatId, reply.slice(offset, offset + TELEGRAM_MESSAGE_LIMIT), fetch, chunk === replyChunks - 1 ? { inlineKeyboard: [[{ text: VIEW_RUN_BUTTON_TEXT, url: `${NOVA_WEB_APP_URL}/app?chatId=${chatId}` }]] } : undefined);
        delivered = true;
      } catch { break; }
    }
    if (!delivered) await sendTelegramMessage(token, telegramChatId, "Nova could not deliver that reply to Telegram. Please try again shortly.").catch(() => {});
    if (run) await finishAgentRunForUser(ownerId, run.id, delivered ? "completed" : "failed", delivered ? undefined : "Telegram delivery failed").catch(() => {});
    if (delivered) trackBackgroundWork(autoTitleChatForUser(ownerId, chatId).catch(() => {}));
    return { delivered, reply, runId: run?.id };
  } catch (error) {
    console.error("[Telegram run] agent run failed", error);
    await sendTelegramMessage(token, telegramChatId, "\u26A0\uFE0F Nova hit an error handling that message. Please try again shortly.").catch(() => {});
    if (run) await finishAgentRunForUser(ownerId, run.id, "failed", error instanceof Error ? error.message : String(error)).catch(() => {});
    return { delivered: false, reply: streamedText, runId: run?.id };
  } finally {
    clearInterval(typingTimer);
  }
}
