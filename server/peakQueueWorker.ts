import { AiGatewayClientError, type GatewayChatMessage } from "./aiGateway";
import { chatWithAiGateway } from "./aiGateway";
import { chatWithCustomModel } from "./byokGateway";
import {
  buildOpenAiChatCompletion,
  InferenceApiError,
  NOVA_PRO_MODEL_ID,
  type InferenceApiModel,
} from "./inferenceApi";
import {
  claimNextInferenceQueueItem,
  completeInferenceQueueItem,
  failInferenceQueueItem,
  requeueStaleInferenceQueueItems,
  getRunningInferenceQueueItem,
  getTelegramCredentialsForUser,
  getCustomModelForUser,
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
 * How long the watchdog will hold one invocation waiting for a running item to
 * go stale before it sweeps and hands the recovered item to a fresh
 * invocation. Kept below the serverless budget so the sweep and the next
 * hand-off still fit.
 */
const MAX_WATCHDOG_WAIT_MS = 240_000;

/**
 * Serves one queued request, then hands the next one to a fresh invocation.
 * One item per call keeps every deferred request inside a single serverless
 * budget and keeps the pool strictly serialized.
 */
export async function advancePeakQueue(): Promise<{ processed: number }> {
  await requeueStaleInferenceQueueItems(new Date(Date.now() - STALE_RUNNING_MS)).catch(() => 0);
  const item = await claimNextInferenceQueueItem();
  if (!item) {
    // Nothing claimable. If a request is still parked in running, its worker
    // may have been killed; watch for the row to go stale and recover it.
    await watchForStaleRunningItem();
    return { processed: 0 };
  }
  try {
    await dispatchInferenceQueueItem(item);
  } catch (error) {
    // A dispatch that throws before it can classify itself still has to free
    // the head of the queue; the raw detail stays server-side.
    console.warn("[Peak queue] Dispatch failed:", error instanceof Error ? error.message : error);
    await failInferenceQueueItem(item.id, describeQueueError(error)).catch(() => {});
  }
  // Work the next item in a fresh invocation, falling back to inline
  // processing when no self-invocation target is configured or the hand-off
  // fails. kickPeakQueue never throws.
  kickPeakQueue();
  return { processed: 1 };
}

/**
 * Blocks until a parked running item is old enough to be treated as
 * abandoned, then sweeps it back to waiting and hands the queue to a fresh
 * invocation. Returns immediately when no running row exists or the wait would
 * not fit this invocation's budget (a later kick recovers it then).
 */
async function watchForStaleRunningItem(): Promise<void> {
  const running = await getRunningInferenceQueueItem().catch(() => undefined);
  if (!running?.startedAt) return;
  const staleAt = running.startedAt.getTime() + STALE_RUNNING_MS;
  const waitMs = staleAt - Date.now();
  if (waitMs <= 0) {
    await requeueStaleInferenceQueueItems(new Date(Date.now() - STALE_RUNNING_MS)).catch(() => 0);
    kickPeakQueue();
    return;
  }
  if (waitMs > MAX_WATCHDOG_WAIT_MS) return;
  await new Promise(resolve => setTimeout(resolve, waitMs));
  await requeueStaleInferenceQueueItems(new Date(Date.now() - STALE_RUNNING_MS)).catch(() => 0);
  kickPeakQueue();
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
    const choice = await resolveQueuedApiChoice(item.ownerId, payload);
    if (!choice) {
      await failInferenceQueueItem(item.id, "the model selected when this request was queued is no longer available");
      return;
    }
    const result = choice.customModel
      ? await chatWithCustomModel(choice.customModel, messages, {})
      : await chatWithAiGateway(item.ownerId, messages, {});
    await completeInferenceQueueItem(item.id, buildOpenAiChatCompletion(result, choice.id) as Record<string, unknown>);
  } catch (error) {
    await failInferenceQueueItem(item.id, describeQueueError(error));
  }
}

/**
 * Re-resolves the model the request was admitted with, from the selection
 * persisted at enqueue time, so a workspace switching its active BYOK model
 * while the request waits cannot reroute or invalidate it.
 */
async function resolveQueuedApiChoice(ownerId: number, payload: InferenceQueuePayload): Promise<InferenceApiModel | undefined> {
  const customModelId = payload.customModelId;
  if (customModelId == null) return { id: NOVA_PRO_MODEL_ID, ownedBy: "nova", customModel: null };
  const customModel = await getCustomModelForUser(ownerId, customModelId);
  if (!customModel) return undefined;
  return { id: customModel.modelId, ownedBy: "byok", customModel };
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

/**
 * The queue poll returns this text to the API caller, so only classification
 * the synchronous path already trusts (a gateway error or a curated inference
 * API error) may be exposed; everything else is logged and replaced with a
 * fixed, generic message.
 */
function describeQueueError(error: unknown): string {
  if (error instanceof AiGatewayClientError || error instanceof InferenceApiError) return error.message;
  console.warn("[Peak queue] Deferred request failed:", error instanceof Error ? error.message : error);
  return "the deferred request hit an unexpected error";
}
