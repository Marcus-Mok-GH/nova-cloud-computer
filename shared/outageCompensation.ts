import { NOVA_WAITLIST_END_ISO, NOVA_WAITLIST_END_MS } from "./waitlist";

/**
 * Goodwill credits for the storage-outage inconvenience.
 *
 * Nova's database hit its provider quota, so every database-backed surface was
 * unavailable while the limits switched over. To make up for the disruption,
 * every EXISTING account is credited a small, permanent balance.
 *
 * The credits land in the bought-credit ledger (`credit_purchases`), which is
 * the only credit bucket that does not expire: the daily allowance is
 * rewritten at UTC midnight, so a gift placed there would evaporate. A
 * bought-credit row is spent only after the daily allowance runs out, and it
 * never expires.
 *
 * The ledger marker is the idempotency key. Each account gets ONE row, keyed
 * by an id derived from its owner id, so the grant can be re-applied without
 * ever granting twice. The migration that writes these rows is
 * `drizzle/neon/0071_outage_credit_compensation.sql`; it hard-codes the same
 * values, and `server/db/creditTopUps.test.ts` asserts the two agree.
 */

/** Credits added to every existing account. */
export const OUTAGE_COMPENSATION_CREDITS = 1_000;

/**
 * Ledger marker for the compensation rows, in the `productId` column.
 *
 * Distinct from every purchasable bundle slug in `shared/creditTopUps.ts`, so
 * a compensation is never mistaken for a purchase and a purchase is never
 * mistaken for a gift.
 */
export const OUTAGE_COMPENSATION_PRODUCT_ID = "outage-compensation";

/**
 * The prefix of a compensation row's payment id.
 *
 * The full id is this prefix plus the owner id, which makes each account's
 * grant unique and re-appliable. It is namespaced by the outage so a future
 * grant can use a different prefix without colliding with this one.
 */
export const OUTAGE_COMPENSATION_PAYMENT_PREFIX = "outage-compensation-2026-11:";

/** The payment id of one account's compensation row. */
export function outageCompensationPaymentId(ownerId: number): string {
  return `${OUTAGE_COMPENSATION_PAYMENT_PREFIX}${ownerId}`;
}

/**
 * The cutoff: accounts created after this instant are NOT compensated.
 *
 * The grant has to be a FIXED set, or the same outage would credit a
 * different set of accounts depending on when the migration happened to run -
 * and re-running it would reach accounts created after the outage, which never
 * experienced it. The instant is the moment Nova comes back
 * (`NOVA_WAITLIST_END_ISO`), so every account that lived through the
 * disruption is covered, and an account that signs up after Nova is back is
 * not.
 */
export const OUTAGE_COMPENSATION_CUTOFF_ISO = NOVA_WAITLIST_END_ISO;
export const OUTAGE_COMPENSATION_CUTOFF_MS = NOVA_WAITLIST_END_MS;
