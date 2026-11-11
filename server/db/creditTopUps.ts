import { and, eq, gt, sql } from "drizzle-orm";
import { creditPurchases } from "../../drizzle/schema";
import { requireDb } from "./core";
import type { CreditTopUpProduct } from "@shared/creditTopUps";

/**
 * Purchased credit bundles.
 *
 * A bundle is granted exactly once per provider payment: the insert carries the
 * payment id through a unique index, so a replayed or retried webhook conflicts
 * instead of granting twice. Spending decrements the oldest bundle that still
 * has credits, so bundles are used in the order they were bought and an unused
 * one never expires.
 */

export type CreditTopUpGrant = {
  ownerId: number;
  providerPaymentId: string;
  product: CreditTopUpProduct;
  currency: string;
};

/**
 * Records a successful payment and grants its credits.
 *
 * Returns `granted: false` when this payment id was already recorded - that is
 * the normal outcome for a redelivered webhook, and the caller should treat it
 * as success (Whop retries until it receives a 2xx).
 */
export async function grantCreditTopUp({
  ownerId,
  providerPaymentId,
  product,
  currency,
}: CreditTopUpGrant): Promise<{ granted: boolean }> {
  const db = await requireDb();
  const inserted = await db
    .insert(creditPurchases)
    .values({
      ownerId,
      providerPaymentId,
      productId: product.id,
      priceCents: product.priceCents,
      currency,
      credits: product.credits,
      remainingCredits: product.credits,
    })
    // The unique index on providerPaymentId is the idempotency guard: a replay
    // conflicts here and returns no row, rather than checking-then-inserting.
    .onConflictDoNothing({ target: creditPurchases.providerPaymentId })
    .returning({ id: creditPurchases.id });
  return { granted: inserted.length > 0 };
}

export type CreditTopUpBalance = {
  /** Credits left across every bundle this account has bought. */
  remainingCredits: number;
  /** How many bundles are still (partly) unspent. */
  activeBundles: number;
  /** Total credits ever bought, for display. */
  purchasedCredits: number;
};

/** The account's purchased-credit balance. */
export async function getCreditTopUpBalanceForUser(ownerId: number): Promise<CreditTopUpBalance> {
  const db = await requireDb();
  const rows = await db
    .select({
      credits: creditPurchases.credits,
      remainingCredits: creditPurchases.remainingCredits,
    })
    .from(creditPurchases)
    .where(eq(creditPurchases.ownerId, ownerId));
  let remaining = 0;
  let purchased = 0;
  let active = 0;
  for (const row of rows) {
    const left = Math.max(0, Number(row.remainingCredits));
    remaining += left;
    purchased += Number(row.credits);
    if (left > 0) active += 1;
  }
  return { remainingCredits: remaining, activeBundles: active, purchasedCredits: purchased };
}

/**
 * Spends one purchased credit from the oldest bundle that still has any.
 *
 * The UPDATE is conditional on `remainingCredits > 0` and the row is chosen by
 * age, so two concurrent requests cannot drive a bundle negative: the loser's
 * WHERE clause matches nothing and it moves on to the next bundle. Returns
 * undefined when the account has no purchased credits left.
 */
export async function claimPurchasedCreditForUser(ownerId: number): Promise<{ purchaseId: number; remainingCredits: number } | undefined> {
  const db = await requireDb();
  // Oldest first: bundles are consumed in the order they were bought.
  const rows = await db
    .select({ id: creditPurchases.id })
    .from(creditPurchases)
    .where(and(eq(creditPurchases.ownerId, ownerId), gt(creditPurchases.remainingCredits, 0)))
    .orderBy(creditPurchases.createdAt, creditPurchases.id)
    .limit(8);
  for (const row of rows) {
    const updated = await db
      .update(creditPurchases)
      .set({
        remainingCredits: sql`${creditPurchases.remainingCredits} - 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(creditPurchases.id, row.id), gt(creditPurchases.remainingCredits, 0)))
      .returning({ remainingCredits: creditPurchases.remainingCredits });
    const claimed = updated[0];
    if (claimed) {
      return { purchaseId: row.id, remainingCredits: Number(claimed.remainingCredits) };
    }
    // Lost the race on this bundle (someone else took the last credit); try the
    // next one rather than reporting exhaustion.
  }
  return undefined;
}