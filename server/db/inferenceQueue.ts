import { and, asc, count, eq, gte, lt, ne, or, sql } from "drizzle-orm";
import { type InferenceQueueItem, type InferenceQueuePayload, inferenceQueue } from "../../drizzle/schema";
import { isPriorityUser } from "./priority";
import { requireDb } from "./core";

/**
 * How many times one deferred request may be claimed before it is dead-lettered.
 * A row that always exceeds its run budget must not monopolize the queue head
 * forever; after this many stale sweeps it is closed as failed.
 */
export const MAX_INFERENCE_QUEUE_ATTEMPTS = 3;

/** How a deferred queue item's result is delivered once it reaches the front. */
export type InferenceQueueChannel = "web" | "telegram" | "api";

export type EnqueueInferenceQueueInput = {
  ownerId: number;
  channel: InferenceQueueChannel;
  chatId?: string | null;
  content: string;
  payload?: InferenceQueuePayload;
};

/**
 * Admits one message to the peak-hours queue. The insert is the whole
 * admission decision: everything already waiting keeps its place, the new row
 * is served strictly after it, and the account's billing plan is denormalized
 * so a later plan change does not reorder an already-admitted request.
 */
export async function enqueueInferenceQueueItem(input: EnqueueInferenceQueueInput): Promise<InferenceQueueItem> {
  const db = await requireDb();
  const priority = await isPriorityUser(input.ownerId).catch(() => false);
  const [item] = await db.insert(inferenceQueue).values({
    ownerId: input.ownerId,
    channel: input.channel,
    chatId: input.chatId ?? null,
    content: input.content,
    payload: input.payload ?? {},
    priority,
  }).returning();
  return item;
}

/**
 * How many requests are ahead of this one, in the queue's serving order
 * (priority first, then arrival): every active item that sorts before it, plus
 * one. A priority item only counts other priority items ahead of it; a
 * standard item counts every priority item plus the standard items that
 * arrived before it.
 */
export async function getInferenceQueuePosition(queueId: number): Promise<number> {
  const db = await requireDb();
  const [item] = await db
    .select({ priority: inferenceQueue.priority, status: inferenceQueue.status })
    .from(inferenceQueue)
    .where(eq(inferenceQueue.id, queueId))
    .limit(1);
  // A running request is the one being served (only one row may run at a time),
  // so nothing is ahead of it no matter what is waiting behind it.
  if (item?.status === "running") return 1;
  const minePriority = item?.priority ?? false;
  // Nothing preempts a request that is already running, so every running row is
  // ahead regardless of priority; beyond that, only the waiting rows the claim
  // query would pick first count. The item itself is excluded so a running item
  // is not counted against itself.
  const waitingAhead = minePriority
    ? and(eq(inferenceQueue.priority, true), lt(inferenceQueue.id, queueId))
    : or(eq(inferenceQueue.priority, true), lt(inferenceQueue.id, queueId));
  const ahead = and(
    ne(inferenceQueue.id, queueId),
    or(
      eq(inferenceQueue.status, "running"),
      and(eq(inferenceQueue.status, "waiting"), waitingAhead),
    ),
  );
  const [result] = await db.select({ ahead: count() }).from(inferenceQueue).where(ahead);
  return Number(result?.ahead ?? 0) + 1;
}

/**
 * Atomically claims the head of the queue, but only while no other request is
 * running. Both guards matter: the status flip makes exactly one concurrent
 * claimer win the head row, and the NOT EXISTS keeps the pool serialized so a
 * second worker invocation cannot start a parallel request.
 */
export async function claimNextInferenceQueueItem(): Promise<InferenceQueueItem | undefined> {
  const db = await requireDb();
  const result = (await db.execute(sql`
    UPDATE "inference_queue" AS q
    SET "status" = 'running', "startedAt" = now(), "attempts" = q."attempts" + 1, "updatedAt" = now()
    WHERE q."id" = (SELECT "id" FROM "inference_queue" WHERE "status" = 'waiting' ORDER BY "priority" DESC, "id" LIMIT 1)
      AND q."status" = 'waiting'
      AND NOT EXISTS (SELECT 1 FROM "inference_queue" WHERE "status" = 'running')
    RETURNING q."id"
  `)) as unknown as { rows?: Array<{ id?: unknown }> } | Array<{ id?: unknown }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const id = Number(rows[0]?.id);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [item] = await db.select().from(inferenceQueue).where(eq(inferenceQueue.id, id)).limit(1);
  return item;
}

/**
 * Returns items whose worker invocation died mid-run (the platform killed it
 * before it could close the row) to the front of the queue, and dead-letters
 * the ones that have already used every attempt so a single budget-busting row
 * cannot hold the head of the line forever.
 */
export async function requeueStaleInferenceQueueItems(staleBefore: Date): Promise<number> {
  const db = await requireDb();
  const stale = and(eq(inferenceQueue.status, "running"), lt(inferenceQueue.startedAt, staleBefore));
  await db
    .update(inferenceQueue)
    .set({ status: "failed", errorMessage: "the deferred request exceeded its run budget on every attempt", completedAt: new Date(), updatedAt: new Date() })
    .where(and(stale, gte(inferenceQueue.attempts, MAX_INFERENCE_QUEUE_ATTEMPTS)));
  const requeued = await db
    .update(inferenceQueue)
    .set({ status: "waiting", startedAt: null, updatedAt: new Date() })
    .where(and(stale, lt(inferenceQueue.attempts, MAX_INFERENCE_QUEUE_ATTEMPTS)))
    .returning({ id: inferenceQueue.id });
  return requeued.length;
}

/** The oldest request currently running, so the worker can watch for a killed invocation. */
export async function getRunningInferenceQueueItem() {
  const db = await requireDb();
  return (await db
    .select()
    .from(inferenceQueue)
    .where(eq(inferenceQueue.status, "running"))
    .orderBy(asc(inferenceQueue.id))
    .limit(1))[0];
}

/** Closes a queue item with its delivered result (the inference API stores its payload here). */
export async function completeInferenceQueueItem(queueId: number, result?: Record<string, unknown> | null) {
  const db = await requireDb();
  const [item] = await db
    .update(inferenceQueue)
    .set({ status: "completed", result: result ?? null, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(inferenceQueue.id, queueId))
    .returning();
  return item;
}

/** Closes a queue item that could not be served. */
export async function failInferenceQueueItem(queueId: number, errorMessage: string) {
  const db = await requireDb();
  const [item] = await db
    .update(inferenceQueue)
    .set({ status: "failed", errorMessage: errorMessage.slice(0, 1200), completedAt: new Date(), updatedAt: new Date() })
    .where(eq(inferenceQueue.id, queueId))
    .returning();
  return item;
}

/**
 * Cancels this owner's still-waiting items - scoped to one chat when `chatId`
 * is given, the whole queue otherwise - so a stop request never silently runs
 * a message the user already abandoned. Running items are left alone; the
 * agent's own stop signal ends those.
 */
export async function cancelWaitingInferenceQueueItemsForUser(ownerId: number, chatId?: string): Promise<number> {
  const db = await requireDb();
  const cancelled = await db
    .update(inferenceQueue)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(inferenceQueue.ownerId, ownerId),
      eq(inferenceQueue.status, "waiting"),
      ...(chatId === undefined ? [] : [eq(inferenceQueue.chatId, chatId)]),
    ))
    .returning({ id: inferenceQueue.id });
  return cancelled.length;
}

/** One queue item, scoped to its owner so a queue id can never leak across accounts. */
export async function getInferenceQueueItemForOwner(ownerId: number, queueId: number) {
  const db = await requireDb();
  return (await db.select().from(inferenceQueue).where(and(eq(inferenceQueue.id, queueId), eq(inferenceQueue.ownerId, ownerId))).limit(1))[0];
}
