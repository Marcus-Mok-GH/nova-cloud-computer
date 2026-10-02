import { AiGatewayClientError, type GatewayChatMessage } from "./aiGateway";
import { chatWithAiGateway } from "./aiGateway";
import { chatWithCustomModel, getActiveCustomModel } from "./byokGateway";
import { buildOpenAiChatCompletion, resolveInferenceModel } from "./inferenceApi";
import {
  claimNextInferenceQueueItem,
  completeInferenceQueueItem,
  failInferenceQueueItem,
  requeueStaleInferenceQueueItems,
  getTelegramCredentialsForUser,
} from "./db";
import { executeTelegramAgentRun, executeWebAgentRun } from "./agentRuns";
import { MAX_RUN_BUDGET_MS } from "./workspaceAgent";
import type { InferenceQueueItem, InferenceQueuePayload } from "../drizzle/schema";
import { kickPeakQueue } from "./peakQueueScheduler";

/**
 * A worker invocation that the platform kills mid-run (it exceeded the
 * function budget before it could close its row) leaves an item stuck in
 * running. Anything running for longer than a whole agent budget plus a
 * generous margin is treated as abandoned and returned to the front.
 */
const STALE_RUNNING_MS = MAX_RUN_BUDGET_MS + 60_000;

/**
 * Serves one queued request, then hands the next one to a fresh invocation.
 * One item per call keeps every deferred request inside a single serverless
 * budget and keeps the pool strictly serialized.
 */
export async function advancePeakQueue(): Promise<{ processed: number }> {
  await requeueStaleInferenceQueueItems(new Date(Date.now() - STALE_RUNNING_MS)).catch(() => 0);
  const item = await claimNextInferenceQueueItem();
  if (!item) return { processed: 0 };
  try {
    await dispatchInferenceQueueItem(item);
  } catch (error) {
    // A dispatch that throws before it can classify itself still has to free
    // the head of the queue; the raw detail stays server-side.
    console.warn("[Peak queue] Dispatch failed:", error instanceof Error ? error.message : error);
    await failInferenceQueueItem(
      item.id,
      error instanceof Error ? error.message : "the deferred request could not be served"
    ).catch(() => {});
  }
  // Work the next item in a fresh invocation, falling back to inline
  // processing when no self-invocation target is configured or the hand-off
  // fails. kickPeakQueue never throws.
  kickPeakQueue();
  return { processed: 1 };
}

async function dispatchInferenceQueueItem(item: InferenceQueueItem): Promise<void> {
  const payload = item.payload ?? {};
  if (item.channel === "api") {
    await dispatchInferenceApiItem(item, payload);
    return;
  }
  if (item.channel === "telegram") {
    await dispatchTelegramItem(item, payload);
    return;
  }
  await dispatchWebItem(item, payload);
}

/** Deferred inference-API call: run it and store the OpenAI-style completion. */
async function dispatchInferenceApiItem(item: InferenceQueueItem, payload: InferenceQueuePayload): Promise<void> {
  try {
    const messages = (payload.messages ?? []) as GatewayChatMessage[];
    const customModel = await getActiveCustomModel(item.ownerId);
    const choice = resolveInferenceModel(customModel, payload.modelId);
    const result = choice.customModel
      ? await chatWithCustomModel(choice.customModel, messages, {})
      : await chatWithAiGateway(item.ownerId, messages, {});
    await completeInferenceQueueItem(item.id, buildOpenAiChatCompletion(result, choice.id) as Record<string, unknown>);
  } catch (error) {
    await failInferenceQueueItem(item.id, describeQueueError(error));
  }
}

/** Deferred Telegram turn: resolve the bot's delivery target and push the reply. */
async function dispatchTelegramItem(item: InferenceQueueItem, payload: InferenceQueuePayload): Promise<void> {
  if (!item.chatId || !payload.notifyChatId) {
    await failInferenceQueueItem(item.id, "the deferred Telegram reply could not resolve its delivery target");
    return;
  }
  const credentials = await getTelegramCredentialsForUser(item.ownerId).catch(() => undefined);
  if (!credentials?.token) {
    await failInferenceQueueItem(item.id, "the deferred Telegram reply could not resolve its bot credentials");
    return;
  }
  const result = await executeTelegramAgentRun({
    ownerId: item.ownerId,
    chatId: item.chatId,
    token: credentials.token,
    telegramChatId: payload.notifyChatId,
    agentText: item.content,
    uploadContext: payload.uploadContext,
    imageAttachments: payload.images,
    requestStartedAtMs: Date.now(),
  });
  if (!result.delivered) {
    // executeTelegramAgentRun already told the user through its own channel and
    // may have chained a continuation, so this only records the queue outcome.
    await failInferenceQueueItem(item.id, "the deferred Telegram reply was not delivered");
    return;
  }
  await completeInferenceQueueItem(item.id);
}

/** Deferred web turn: runWorkspaceAgent persists the reply; the client polls for it. */
async function dispatchWebItem(item: InferenceQueueItem, payload: InferenceQueuePayload): Promise<void> {
  if (!item.chatId) {
    await failInferenceQueueItem(item.id, "the deferred reply could not resolve its conversation");
    return;
  }
  try {
    await executeWebAgentRun({
      ownerId: item.ownerId,
      chatId: item.chatId,
      content: item.content,
      uploadContext: payload.uploadContext,
      imageAttachments: payload.images,
      requestStartedAtMs: Date.now(),
    });
    await completeInferenceQueueItem(item.id);
  } catch (error) {
    await failInferenceQueueItem(item.id, describeQueueError(error));
  }
}

function describeQueueError(error: unknown): string {
  if (error instanceof AiGatewayClientError || error instanceof Error) return error.message;
  return "the deferred request hit an unexpected error";
}
