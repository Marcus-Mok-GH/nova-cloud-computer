import { createHmac } from "node:crypto";
import { ENV } from "./_core/env";
import { startAgentRunForUser, finishAgentRunForUser, holdAgentRunForContinue, MAX_RUN_SEGMENTS } from "./db";
import { autoTitleChatForUser, runWorkspaceAgent, MAX_RUN_BUDGET_MS } from "./workspaceAgent";
import { sendChatAction, sendTelegramMessage } from "./telegram";
import { trackBackgroundWork } from "./backgroundWork";

/** The web app that renders each chat's full tool-activity replay. */
export const NOVA_WEB_APP_URL = "https://nova-cloud-computer.vercel.app";
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const VIEW_RUN_BUTTON_TEXT = "\u{1FA90} View this run in Nova";
/** When a segment runs out of budget mid-task, the continuation prompt lets the next segment resume the same chat history. */
export const CONTINUATION_PROMPT = "Continue the task in this conversation from where the previous segment left off. That segment ran out of its execution budget; finish the remaining work and deliver the result."
/** Sent only when an out-of-budget segment cannot chain its automatic continuation: the user must then resume manually. */
export const CONTINUATION_SCHEDULE_FAILED_MESSAGE = "I ran out of time on that task and could not schedule the automatic continuation, so it stopped here. Send \"continue\" and I will pick up exactly where I left off.";

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
  /** Continuation segments pass the claimed ledger row; fresh runs omit it. */
  continuation?: { runId: number; segment: number };
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
  const { ownerId, chatId, token, telegramChatId, agentText, uploadContext, imageAttachments, requestStartedAtMs, continuation } = input;
  const deadlineAtMs = requestStartedAtMs + MAX_RUN_BUDGET_MS;
  const isContinuation = Boolean(continuation);
  // Whether this segment may chain into an automatic continuation. Known
  // before the run starts so the deadline closing status can be written as
  // a passive progress note (not "send continue") whenever the chain will
  // carry the work on by itself.
  const canChain = Boolean(ENV.agentContinueSecret);
  // The ledger is best-effort: a database hiccup must never block the reply.
  const run = continuation
    ? { id: continuation.runId, segment: continuation.segment }
    : await startAgentRunForUser(ownerId, { chatId, notifyChatId: telegramChatId }).catch(() => undefined);
  let streamedText = "";
  /* No "Thinking..." placeholder: a placeholder became a permanent orphan bubble whenever its final edit failed, and streaming edits collided with Telegram's per-second edit limit during long runs. A typing action refreshed until the reply lands keeps the chat clean. */
  const typingTimer = setInterval(() => { void sendChatAction(token, telegramChatId, "typing").catch(() => {}); }, 4500);
  try {
    await sendChatAction(token, telegramChatId, "typing");
    const result = await runWorkspaceAgent(ownerId, chatId, agentText + (uploadContext ?? ""), {
      channel: "telegram",
      imageAttachments,
      deadlineAtMs,
      continuationPlanned: canChain && run !== undefined && run.segment < MAX_RUN_SEGMENTS - 1,
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
    if (run) {
      // A segment that ran out of budget with work remaining chains to a fresh
      // serverless invocation (a new 300s budget) via the continuation
      // endpoint, up to the segment limit. If the chain cannot be scheduled,
      // the run closes completed and the user is told to send "continue" -
      // the deadline status they already received assumed an automatic
      // continuation was on its way.
      const canContinue = Boolean(result.outOfBudget) && run.segment < MAX_RUN_SEGMENTS - 1 && canChain;
      if (delivered && canContinue) {
        const held = await holdAgentRunForContinue(ownerId, run.id).catch(() => undefined);
        const scheduled = held ? await scheduleContinuation(run.id, run.segment) : false;
        if (!scheduled) {
          await finishAgentRunForUser(ownerId, run.id, "completed").catch(() => {});
          // The closing status said the work continues automatically, so the
          // user must be told when that turns out not to be true.
          await sendTelegramMessage(token, telegramChatId, CONTINUATION_SCHEDULE_FAILED_MESSAGE).catch(() => {});
        }
      } else {
        await finishAgentRunForUser(ownerId, run.id, delivered ? "completed" : "failed", delivered ? undefined : "Telegram delivery failed").catch(() => {});
      }
    }
    if (delivered && !isContinuation) trackBackgroundWork(autoTitleChatForUser(ownerId, chatId).catch(() => {}));
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

/**
 * Self-invokes the continuation endpoint so the next segment runs in a fresh
 * serverless invocation with its own 300s budget. The HMAC signature lets
 * the endpoint trust the request without exposing it publicly.
 */
export async function scheduleContinuation(runId: number, segment: number): Promise<boolean> {
  const secret = ENV.agentContinueSecret;
  if (!secret) return false;
  const body = JSON.stringify({ runId, segment });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${ENV.publicBaseUrl}/api/agent/continue`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nova-signature": `sha256=${signature}` },
      body,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
