import { createHmac } from "node:crypto";
import {
  LEGACY_MISTRAL_UNAVAILABLE_PREFIX,
  MISTRAL_UNAVAILABLE_PREFIX,
} from "@shared/const";
import { ENV } from "./_core/env";
import { MistralGatewayClientError } from "./mistralGateway";
import {
  startAgentRunForUser,
  finishAgentRunForUser,
  holdAgentRunForContinue,
  appendChatMessageForUser,
} from "./db";
import {
  autoTitleChatForUser,
  runWorkspaceAgent,
  MAX_RUN_BUDGET_MS,
} from "./workspaceAgent";
import { sendChatAction, sendTelegramMessage } from "./telegram";
import { trackBackgroundWork } from "./backgroundWork";

/** The web app that renders each chat's full tool-activity replay. */
export const NOVA_WEB_APP_URL = "https://nova-cloud-computer.vercel.app";
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const VIEW_RUN_BUTTON_TEXT = "\u{1FA90} View this run in Nova";
/**
 * When a segment ends before the work is finished (its execution budget ran
 * out or it hit a transient service error), the continuation prompt lets the
 * next segment resume the same chat history.
 */
export const CONTINUATION_PROMPT =
  "Continue the task in this conversation from where the previous segment left off. That segment ended before the work was finished (its execution time ran out or it hit a temporary service error); finish the remaining work and deliver the result.";
/** Sent only when an out-of-budget segment cannot chain its automatic continuation: the user must then resume manually. */
export const CONTINUATION_SCHEDULE_FAILED_MESSAGE =
  'I ran out of time on that task and could not schedule the automatic continuation, so it stopped here. Send "continue" and I will pick up exactly where I left off.';
/** Closing note when an out-of-budget segment chained successfully but the model-written status could not be produced. */
export const STILL_WORKING_MESSAGE =
  "⏳ Still working - the task continues automatically and the next update follows shortly.";
/** Closing note when a segment hit a transient upstream error mid-task but the chain rescued it. */
export const TRANSIENT_ERROR_CONTINUING_MESSAGE =
  "⚠️ Nova hit a temporary service error mid-task. The work already done is safe - the task continues automatically in a few seconds.";
/** How many times the continuation self-call is attempted before giving up and telling the user to resume manually. */
const CONTINUATION_SCHEDULE_ATTEMPTS = 3;
/** Pause between continuation scheduling attempts. */
const CONTINUATION_RETRY_DELAY_MS = 1_500;
/**
 * A segment only earns an error rescue when it already did real work: a
 * failure that strikes this early means the service is hard down (or the
 * error is permanent), and chaining would only burn another invocation to
 * fail the same way, so the run fails outright as before.
 */
const RESCUABLE_SEGMENT_MIN_MS = 120_000;

/**
 * Errors worth rescuing with a fresh continuation segment: transient
 * upstream failures a retry can plausibly clear. Configuration problems, a
 * spent allowance or daily credits, and bad requests are permanent for this
 * deployment - a chained segment would fail identically, so they are not
 * rescued. Unknown errors are treated as permanent for the same reason.
 */
export function isTransientRunError(error: unknown): boolean {
  if (error instanceof MistralGatewayClientError) {
    return (
      error.kind === "unavailable" ||
      error.kind === "rate_limit" ||
      error.kind === "invalid_response"
    );
  }
  if (error instanceof Error && error.name === "AbortError") return true;
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /timeout|timed out|abort|network|fetch failed|econnreset|econnrefused|eai_again|enotfound|socket hang up|502|503|504|overload|stall|temporarily unavailable|service unavailable/i.test(
    message
  );
}

/**
 * Holds a live run row for its next segment, then schedules the automatic
 * continuation. One helper so the budget close and the error rescue share
 * exactly the same chain mechanics; returns false whenever the row cannot
 * be held or the continuation cannot be scheduled.
 */
async function holdAndScheduleContinuation(
  ownerId: number,
  runId: number,
  segment: number
): Promise<boolean> {
  const held = await holdAgentRunForContinue(ownerId, runId).catch(
    () => undefined
  );
  return held ? await scheduleContinuation(runId, segment) : false;
}

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
export async function executeTelegramAgentRun(
  input: ExecuteTelegramRunInput
): Promise<ExecuteTelegramRunResult> {
  const {
    ownerId,
    chatId,
    token,
    telegramChatId,
    agentText,
    uploadContext,
    imageAttachments,
    requestStartedAtMs,
    continuation,
  } = input;
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
    : await startAgentRunForUser(ownerId, {
        chatId,
        notifyChatId: telegramChatId,
      }).catch(() => undefined);
  let streamedText = "";
  /* No "Thinking..." placeholder: a placeholder became a permanent orphan bubble whenever its final edit failed, and streaming edits collided with Telegram's per-second edit limit during long runs. A typing action refreshed until the reply lands keeps the chat clean. */
  const typingTimer = setInterval(() => {
    void sendChatAction(token, telegramChatId, "typing").catch(() => {});
  }, 4500);
  try {
    await sendChatAction(token, telegramChatId, "typing");
    const result = await runWorkspaceAgent(
      ownerId,
      chatId,
      agentText + (uploadContext ?? ""),
      {
        channel: "telegram",
        imageAttachments,
        deadlineAtMs,
        continuationPlanned: canChain && run !== undefined,
        onChunk: async (chunk: string) => {
          streamedText += chunk;
        },
      }
    );
    const rawReply = String(
      result.message?.content ??
        streamedText ??
        "I'm ready to help with this workspace."
    ).trim();
    // The failure marker is an internal detection hook for the web UI;
    // Telegram users get the notice without it (legacy markers included).
    const reply = rawReply.startsWith(MISTRAL_UNAVAILABLE_PREFIX)
      ? rawReply.slice(MISTRAL_UNAVAILABLE_PREFIX.length)
      : rawReply.startsWith(LEGACY_MISTRAL_UNAVAILABLE_PREFIX)
        ? rawReply.slice(LEGACY_MISTRAL_UNAVAILABLE_PREFIX.length)
        : rawReply;
    // Chain the continuation BEFORE delivering anything: scheduling is the
    // survival-critical step (it must fit inside the remaining runtime
    // budget), and a Telegram delivery hiccup must never kill the task -
    // the next segment delivers the eventual final result itself. An
    // out-of-budget reply is a progress note, not the task's answer.
    const outOfBudget = Boolean(result.outOfBudget) && canChain;
    const chained =
      run && outOfBudget
        ? await holdAndScheduleContinuation(ownerId, run.id, run.segment)
        : false;
    if (!reply && !chained) {
      await sendTelegramMessage(
        token,
        telegramChatId,
        "Nova could not finish that reply. Please try again shortly."
      );
      if (run)
        await finishAgentRunForUser(
          ownerId,
          run.id,
          "failed",
          "the run produced an empty reply"
        ).catch(() => {});
      return { delivered: false, reply: "", runId: run?.id };
    }
    // The model-written deadline status could not be produced (the gateway
    // stayed silent) but the chain is alive: keep the user oriented with a
    // brief canned note instead of an empty turn.
    if (!reply && chained) {
      await sendTelegramMessage(
        token,
        telegramChatId,
        STILL_WORKING_MESSAGE
      ).catch(() => {});
    }
    let delivered = false;
    if (reply) {
      const replyChunks = Math.max(
        1,
        Math.ceil(reply.length / TELEGRAM_MESSAGE_LIMIT)
      );
      for (let chunk = 0; chunk < replyChunks; chunk++) {
        const offset = chunk * TELEGRAM_MESSAGE_LIMIT;
        try {
          await sendTelegramMessage(
            token,
            telegramChatId,
            reply.slice(offset, offset + TELEGRAM_MESSAGE_LIMIT),
            fetch,
            chunk === replyChunks - 1
              ? {
                  inlineKeyboard: [
                    [
                      {
                        text: VIEW_RUN_BUTTON_TEXT,
                        url: `${NOVA_WEB_APP_URL}/app?chatId=${chatId}`,
                      },
                    ],
                  ],
                }
              : undefined
          );
          delivered = true;
        } catch {
          break;
        }
      }
      if (!delivered)
        await sendTelegramMessage(
          token,
          telegramChatId,
          "Nova could not deliver that reply to Telegram. Please try again shortly."
        ).catch(() => {});
    }
    if (run) {
      if (chained) {
        // The claimed next segment owns the ledger row now; it closes the run
        // when the task finishes. Nothing else to do here.
      } else if (outOfBudget) {
        // The deadline status the user received said the work continues
        // automatically, so the user must be told when that turns out not to
        // be true - the chain could not be scheduled after all.
        await finishAgentRunForUser(ownerId, run.id, "completed").catch(
          () => {}
        );
        await sendTelegramMessage(
          token,
          telegramChatId,
          CONTINUATION_SCHEDULE_FAILED_MESSAGE
        ).catch(() => {});
      } else {
        await finishAgentRunForUser(
          ownerId,
          run.id,
          delivered ? "completed" : "failed",
          delivered ? undefined : "Telegram delivery failed"
        ).catch(() => {});
      }
    }
    if (delivered && !isContinuation)
      trackBackgroundWork(
        autoTitleChatForUser(ownerId, chatId).catch(() => {})
      );
    return { delivered, reply, runId: run?.id };
  } catch (error) {
    console.error("[Telegram run] agent run failed", error);
    // A transient upstream failure must not throw away the work this
    // segment already did: hold the ledger row and chain a fresh segment
    // that resumes where this one broke off. Only failures that are
    // permanent for this deployment (bad configuration, spent allowance)
    // or that strike almost immediately (the service is hard down) fail
    // outright as before.
    if (
      run &&
      canChain &&
      Date.now() - requestStartedAtMs >= RESCUABLE_SEGMENT_MIN_MS &&
      isTransientRunError(error)
    ) {
      const rescued = await holdAndScheduleContinuation(
        ownerId,
        run.id,
        run.segment
      );
      if (rescued) {
        await sendTelegramMessage(
          token,
          telegramChatId,
          TRANSIENT_ERROR_CONTINUING_MESSAGE
        ).catch(() => {});
        return { delivered: false, reply: streamedText, runId: run.id };
      }
    }
    // The raw error (provider, database, or sandbox internals) stays in the
    // server log above and in the run ledger below; the Telegram user only
    // ever gets this fixed, generic notice.
    const detail = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(
      token,
      telegramChatId,
      "\u26A0\uFE0F Nova hit an unexpected error handling that message. Please try again shortly."
    ).catch(() => {});
    if (run)
      await finishAgentRunForUser(ownerId, run.id, "failed", detail).catch(
        () => {}
      );
    return { delivered: false, reply: streamedText, runId: run?.id };
  } finally {
    clearInterval(typingTimer);
  }
}

export interface ExecuteWebAgentRunInput {
  ownerId: number;
  /** The workspace chat the run belongs to. */
  chatId: number;
  /** The clean user text for this segment (the original message, or the continuation prompt). */
  content: string;
  imageAttachments?: string[];
  requestStartedAtMs: number;
  /** Continuation segments pass the claimed ledger row; fresh runs omit it. */
  continuation?: { runId: number; segment: number };
  onChunk?: (chunk: string) => void;
  onEvent?: (event: unknown) => void;
}

/**
 * Runs one agent segment for the Nova web app's own chat (the
 * `/api/chat/stream` endpoint and the `chats.send` mutation) and returns the
 * result unchanged, plus the run's ledger id. Unlike Telegram, a chained
 * continuation needs no external delivery step: runWorkspaceAgent already
 * persists its own reply into the chat, and the web client polls chat
 * messages every few seconds, so a continuation segment's reply surfaces
 * there automatically with no action from this function.
 */
export async function executeWebAgentRun(
  input: ExecuteWebAgentRunInput
): Promise<Awaited<ReturnType<typeof runWorkspaceAgent>> & { runId?: number }> {
  const {
    ownerId,
    chatId,
    content,
    imageAttachments,
    requestStartedAtMs,
    continuation,
    onChunk,
    onEvent,
  } = input;
  const deadlineAtMs = requestStartedAtMs + MAX_RUN_BUDGET_MS;
  const canChain = Boolean(ENV.agentContinueSecret);
  const run = continuation
    ? { id: continuation.runId, segment: continuation.segment }
    : await startAgentRunForUser(ownerId, { chatId, channel: "web" }).catch(
        () => undefined
      );
  try {
    const result = await runWorkspaceAgent(ownerId, chatId, content, {
      channel: "web",
      imageAttachments,
      deadlineAtMs,
      continuationPlanned: canChain && run !== undefined,
      onChunk,
      onEvent,
    });
    if (run) {
      // A segment that ran out of budget with work remaining chains to a
      // fresh serverless invocation, exactly like the Telegram path - the
      // only difference is there is no external message to send.
      const chained =
        Boolean(result.outOfBudget) && canChain
          ? await holdAndScheduleContinuation(ownerId, run.id, run.segment)
          : false;
      if (chained) {
        // The claimed next segment owns the ledger row now; it closes the
        // run when the task finishes.
      } else if (Boolean(result.outOfBudget) && canChain) {
        await finishAgentRunForUser(ownerId, run.id, "completed").catch(
          () => {}
        );
        // The closing status the user already saw assumed an automatic
        // continuation was on its way - say so plainly when it wasn't.
        await appendChatMessageForUser(ownerId, {
          chatId,
          role: "assistant",
          content: CONTINUATION_SCHEDULE_FAILED_MESSAGE,
        }).catch(() => {});
      } else {
        await finishAgentRunForUser(ownerId, run.id, "completed").catch(
          () => {}
        );
      }
    }
    return { ...result, runId: run?.id };
  } catch (error) {
    // A transient upstream failure must not throw away the work this
    // segment already did: rescue it with a fresh continuation segment,
    // exactly like the Telegram path. The note persists into the chat so
    // the polling client understands the gap; the continuation segment
    // delivers the real result.
    if (
      run &&
      canChain &&
      Date.now() - requestStartedAtMs >= RESCUABLE_SEGMENT_MIN_MS &&
      isTransientRunError(error)
    ) {
      const rescued = await holdAndScheduleContinuation(
        ownerId,
        run.id,
        run.segment
      );
      if (rescued) {
        const note = await appendChatMessageForUser(ownerId, {
          chatId,
          role: "assistant",
          content: TRANSIENT_ERROR_CONTINUING_MESSAGE,
        }).catch(() => undefined);
        return { message: note, actions: [], outOfBudget: true, runId: run.id };
      }
    }
    if (run)
      await finishAgentRunForUser(
        ownerId,
        run.id,
        "failed",
        error instanceof Error ? error.message : String(error)
      ).catch(() => {});
    throw error;
  }
}

/**
 * Self-invokes the continuation endpoint so the next segment runs in a fresh
 * serverless invocation with its own 300s budget. The HMAC signature lets
 * the endpoint trust the request without exposing it publicly.
 */
export async function scheduleContinuation(
  runId: number,
  segment: number
): Promise<boolean> {
  const secret = ENV.agentContinueSecret;
  if (!secret) return false;
  // A single failed self-call once ended the whole chain - one dropped
  // request between two segments threw away all the finished work. The
  // endpoint acks within milliseconds once the claim lands, so retries are
  // cheap; the caller's remaining runtime budget bounds the loop naturally.
  for (let attempt = 1; ; attempt += 1) {
    if (await scheduleContinuationOnce(secret, runId, segment)) return true;
    if (attempt >= CONTINUATION_SCHEDULE_ATTEMPTS) return false;
    await new Promise(resolve =>
      setTimeout(resolve, CONTINUATION_RETRY_DELAY_MS)
    );
  }
}

async function scheduleContinuationOnce(
  secret: string,
  runId: number,
  segment: number
): Promise<boolean> {
  const body = JSON.stringify({ runId, segment });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${ENV.publicBaseUrl}/api/agent/continue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nova-signature": `sha256=${signature}`,
      },
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
