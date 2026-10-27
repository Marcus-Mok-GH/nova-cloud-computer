import { and, eq, isNull } from "drizzle-orm";
import { priorityPurchases } from "../../drizzle/schema";
import { requireDb } from "./core";

/**
 * How long one priority window keeps an account ahead of the standard queue.
 * The clock starts on the first message sent after the purchase (see
 * activatePriorityWindowForUser), not at the moment of purchase.
 */
export const PRIORITY_DURATION_MS = 60 * 60 * 1000;

/** One-time priority purchase price in minor units (S$4.99). */
export const PRIORITY_PRICE_CENTS = 499;

/** Currency for the one-time priority purchase (matches site billing). */
export const PRIORITY_CURRENCY = "sgd";

/** When a window activated at `activatedAt` stops granting priority. */
function priorityExpiresAt(activatedAt: Date): Date {
  return new Date(activatedAt.getTime() + PRIORITY_DURATION_MS);
}

/**
 * An account's priority state: `armed` means bought but not yet started (the
 * clock begins on the next message), `priority` means the hour is counting down.
 */
export type PriorityStatus = {
  priority: boolean;
  armed: boolean;
  purchasedAt: Date | null;
  activatedAt: Date | null;
  expiresAt: Date | null;
};

const NO_PRIORITY: PriorityStatus = { priority: false, armed: false, purchasedAt: null, activatedAt: null, expiresAt: null };

export async function getPriorityStatusForUser(ownerId: number): Promise<PriorityStatus> {
  const db = await requireDb();
  const row = (await db.select().from(priorityPurchases).where(eq(priorityPurchases.ownerId, ownerId)).limit(1))[0];
  if (!row) return NO_PRIORITY;
  // An unactivated purchase is armed: no clock yet, so it is not priority.
  if (!row.activatedAt) return { priority: false, armed: true, purchasedAt: row.purchasedAt, activatedAt: null, expiresAt: null };
  const expiresAt = priorityExpiresAt(row.activatedAt);
  return { priority: expiresAt.getTime() > Date.now(), armed: false, purchasedAt: row.purchasedAt, activatedAt: row.activatedAt, expiresAt };
}

/**
 * True while the account's priority window is still counting down, so newly
 * admitted requests jump ahead. An armed or expired purchase is not priority.
 */
export async function isPriorityUser(ownerId: number): Promise<boolean> {
  const db = await requireDb();
  const row = (await db.select({ activatedAt: priorityPurchases.activatedAt }).from(priorityPurchases).where(eq(priorityPurchases.ownerId, ownerId)).limit(1))[0];
  return Boolean(row?.activatedAt && priorityExpiresAt(row.activatedAt).getTime() > Date.now());
}

/**
 * Starts an armed purchase's one-hour window on the message that consumes it,
 * and reports whether the account is priority for this admission. The caller
 * awaits this before handing the message to the agent, so the countdown is
 * confirmed (persisted) before the AI starts working. The conditional update
 * starts the window exactly once: concurrent messages race on the same row and
 * only the winner reports `justActivated` (and shows the confirmation).
 */
export async function activatePriorityWindowForUser(ownerId: number): Promise<{ priority: boolean; justActivated: boolean; expiresAt: Date | null }> {
  const db = await requireDb();
  const status = await getPriorityStatusForUser(ownerId);
  if (status.priority) return { priority: true, justActivated: false, expiresAt: status.expiresAt };
  if (!status.armed) return { priority: false, justActivated: false, expiresAt: null };
  const activatedAt = new Date();
  const [started] = await db
    .update(priorityPurchases)
    .set({ activatedAt, updatedAt: activatedAt })
    .where(and(eq(priorityPurchases.ownerId, ownerId), isNull(priorityPurchases.activatedAt)))
    .returning({ id: priorityPurchases.id });
  if (!started) {
    // Another message won the race and already started the window.
    return { priority: true, justActivated: false, expiresAt: priorityExpiresAt(activatedAt) };
  }
  return { priority: true, justActivated: true, expiresAt: priorityExpiresAt(activatedAt) };
}

/**
 * Arms priority after Whop confirms payment. Buying again clears any previous
 * window so the next message starts a fresh hour; there is nothing to cancel.
 */
export async function purchasePriorityForUser(ownerId: number): Promise<PriorityStatus> {
  const db = await requireDb();
  const purchasedAt = new Date();
  await db
    .insert(priorityPurchases)
    .values({ ownerId, purchasedAt, activatedAt: null })
    .onConflictDoUpdate({ target: priorityPurchases.ownerId, set: { purchasedAt, activatedAt: null, updatedAt: purchasedAt } });
  return getPriorityStatusForUser(ownerId);
}
