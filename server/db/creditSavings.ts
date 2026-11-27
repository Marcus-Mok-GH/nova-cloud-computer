/**
 * Credit savings: two reserves, one per credit source.
 *
 * Nova has two credit sources with opposite expiry rules - the daily
 * allowance is REWRITTEN at UTC midnight, while a purchased bundle never
 * expires - so the savings they feed are kept in two separate ledgers and
 * are never merged:
 *
 *   daily_credit_savings - credits set aside from the daily allowance
 *   paid_credit_savings  - credits set aside from a purchased bundle
 *
 * Setting credits aside MOVES them, it never mints them. A daily set-aside
 * takes the credits out of TODAY's allowance - the daily ledger's
 * `usedCredits` counter goes up by the same amount, so the day's remaining
 * balance drops by the same amount - and the credits join the daily savings
 * balance, where they survive the midnight reset. A paid set-aside takes the
 * credits out of the oldest bundles that still hold any. Either way the
 * account's total spendable credits are unchanged by the move.
 *
 * `daily_credits` is deliberately NOT given a new column for this: it is the
 * hot credit ledger, and a column whose migration had not run yet would make
 * every existing credit query fail with `column ... does not exist` - the
 * live crash this feature is meant to avoid. The `usedCredits` counter already
 * means "credits committed out of today's allowance", which is exactly what a
 * set-aside is, and the daily claim's cap already reads it, so the day's
 * spendable allowance shrinks by the same amount for free.
 *
 * Each balance is ONE row per account, not one row per deposit. The daily
 * balance is capped at ONE day's allowance, and a cap read as a cross-row
 * aggregate is read from the statement SNAPSHOT: two concurrent set-asides
 * would both observe the same pre-race total, both pass the guard, and the
 * balance would end up over its cap. A single row per account can be locked
 * with `SELECT ... FOR UPDATE`, so the loser's re-read sees the winner's
 * committed total and refuses. The paid balance is uncapped, because paid
 * credits never expire.
 *
 * The daily balance's expiry window has no prior art in this repo (the
 * retired monthly pool carried over for 12 months, but the daily pool
 * replaced it deliberately), so the daily savings simply roll over for as
 * long as the account keeps them - bounded by the one-day cap, which is what
 * keeps them a buffer rather than a second allowance.
 *
 * Savings are spent LAST: the gateway still drains the daily allowance and
 * then the bought bundles, and only draws on a savings balance when both are
 * dry. An account holding no savings therefore behaves EXACTLY as it did
 * before this feature existed.
 *
 * Every read and write here degrades gracefully when the tables do not exist
 * yet (the migration has not run because the database is unreachable): a
 * missing relation must never crash the page that shows a balance or the
 * request that spends a credit.
 */
import { eq, sql } from "drizzle-orm";
import { dailyCreditSavings, paidCreditSavings } from "../../drizzle/schema";
import { requireDb } from "./core";
import { getDailyCreditStatusForUser } from "./credits";
import { getCreditTopUpBalanceForUser } from "./creditTopUps";
import { isMissingRelation } from "./pgErrors";

/** Which credit source a savings balance belongs to. */
export type SavingsSource = "daily" | "paid";

export type SavingsBalance = {
  /** Credits ever moved into savings from this source. */
  savedCredits: number;
  /** How many of them are still unspent. */
  remainingCredits: number;
};

export type CreditSavingsBalances = {
  daily: SavingsBalance;
  paid: SavingsBalance;
};

/** What the account holds in savings and what it could still set aside. */
export type CreditSavingsOverview = CreditSavingsBalances & {
  /** Credits that could still be set aside from today's daily allowance. */
  dailyAvailable: number;
  /** Credits that could still be set aside from the bought bundles. */
  paidAvailable: number;
};

export type SaveToSavingsResult =
  | { ok: true; balances: CreditSavingsBalances }
  | {
      ok: false;
      reason:
        | "invalid_amount"
        | "unlimited_allowance"
        | "insufficient_credits"
        | "savings_unavailable";
    };

const EMPTY_BALANCE: SavingsBalance = { savedCredits: 0, remainingCredits: 0 };

function emptyBalances(): CreditSavingsBalances {
  return { daily: { ...EMPTY_BALANCE }, paid: { ...EMPTY_BALANCE } };
}

/** The physical table a source's balance lives in. */
function tableFor(source: SavingsSource) {
  return source === "daily" ? dailyCreditSavings : paidCreditSavings;
}

/** The table name in SQL (the physical tables are named, not derived). */
function tableNameFor(source: SavingsSource): string {
  return source === "daily" ? "daily_credit_savings" : "paid_credit_savings";
}

/**
 * Both savings balances for the account.
 *
 * Each source is read on its own so a table that is missing cannot hide the
 * other source's balance.
 */
export async function getCreditSavingsForUser(ownerId: number): Promise<CreditSavingsBalances> {
  const db = await requireDb();
  const readDaily = async (): Promise<SavingsBalance> => {
    try {
      const rows = await db
        .select({
          savedCredits: dailyCreditSavings.credits,
          remainingCredits: dailyCreditSavings.remainingCredits,
        })
        .from(dailyCreditSavings)
        .where(eq(dailyCreditSavings.ownerId, ownerId))
        .limit(1);
      return {
        savedCredits: Number(rows[0]?.savedCredits ?? 0),
        remainingCredits: Number(rows[0]?.remainingCredits ?? 0),
      };
    } catch (error) {
      if (isMissingRelation(error)) return { ...EMPTY_BALANCE };
      throw error;
    }
  };
  const readPaid = async (): Promise<SavingsBalance> => {
    try {
      const rows = await db
        .select({
          savedCredits: paidCreditSavings.credits,
          remainingCredits: paidCreditSavings.remainingCredits,
        })
        .from(paidCreditSavings)
        .where(eq(paidCreditSavings.ownerId, ownerId))
        .limit(1);
      return {
        savedCredits: Number(rows[0]?.savedCredits ?? 0),
        remainingCredits: Number(rows[0]?.remainingCredits ?? 0),
      };
    } catch (error) {
      if (isMissingRelation(error)) return { ...EMPTY_BALANCE };
      throw error;
    }
  };
  const [daily, paid] = await Promise.all([readDaily(), readPaid()]);
  return { daily, paid };
}

/**
 * The savings view the billing page shows: both balances plus how much the
 * account could still set aside from each source.
 */
export async function getCreditSavingsOverviewForUser(
  ownerId: number
): Promise<CreditSavingsOverview> {
  const balances = await getCreditSavingsForUser(ownerId);
  const [status, topUps] = await Promise.all([
    getDailyCreditStatusForUser(ownerId),
    getCreditTopUpBalanceForUser(ownerId),
  ]);
  // An unlimited ledger has no allowance to set aside.
  const dailyAllocation = status.unlimited ? 0 : status.dailyCredits ?? 0;
  // The daily pot may hold at most one day's allowance, so what can still be
  // set aside is the smaller of today's remaining balance and the room left in
  // the pot.
  const dailyRoom = Math.max(0, dailyAllocation - balances.daily.remainingCredits);
  return {
    ...balances,
    dailyAvailable: Math.min(status.remainingCredits ?? 0, dailyRoom),
    paidAvailable: topUps.remainingCredits,
  };
}

/**
 * Makes sure the account's balance row exists so the set-aside can LOCK it.
 *
 * This is a separate statement on purpose: the row is created EMPTY, so it
 * moves no credits, and the move itself stays a single statement (debit and
 * credit together). Doing the insert inside the move statement would touch
 * the same row twice, which Postgres rejects with
 * `ON CONFLICT DO UPDATE command cannot affect row a second time`.
 */
async function ensureBalanceRow(source: SavingsSource, ownerId: number): Promise<void> {
  const db = await requireDb();
  const table = tableNameFor(source);
  await db.execute(sql`
    INSERT INTO "${sql.raw(table)}" ("ownerId","credits","remainingCredits","createdAt","updatedAt")
    VALUES (${ownerId}, 0, 0, now(), now())
    ON CONFLICT ("ownerId") DO NOTHING
  `);
}

/**
 * Moves credits out of a live balance and into the matching savings balance.
 *
 * Daily source: the credits leave TODAY's allowance and join the daily
 * savings balance, where they survive the midnight reset. The balance can
 * hold at most one day's allowance, so daily savings stay a buffer rather
 * than a second allowance.
 *
 * Paid source: the credits leave the oldest bundles that still hold any,
 * oldest first, and join the paid savings balance.
 *
 * Either way the account's total spendable credits are unchanged.
 */
export async function saveCreditsToSavings(
  ownerId: number,
  source: SavingsSource,
  credits: number
): Promise<SaveToSavingsResult> {
  if (!Number.isInteger(credits) || credits <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const db = await requireDb();
  try {
    if (source === "daily") {
      // The same allowance the client is shown, so "set aside" can never take
      // more than the balance the account can actually spend today.
      const status = await getDailyCreditStatusForUser(ownerId);
      // An unlimited ledger has no allowance to set aside.
      if (status.unlimited || status.dailyCredits == null) {
        return { ok: false, reason: "unlimited_allowance" };
      }
      const allocation = status.dailyCredits;
      const creditDay = status.creditDay;
      const region = status.region;
      // The balance row has to exist before the move can lock it.
      await ensureBalanceRow("daily", ownerId);
      // One statement: the balance row is LOCKED, the amount it already holds
      // is read from that lock, the debit of today's allowance is gated on the
      // cap, and the balance is credited - all in one atomic move.
      //
      // The lock is what makes the cap exact. The loser of a race waits for
      // the winner's commit and then re-reads the balance, so it sees the
      // amount the winner just added and refuses instead of adding on top.
      const result = await db.execute(sql`
        WITH wallet AS MATERIALIZED (
          SELECT "remainingCredits" AS "held"
          FROM "daily_credit_savings"
          WHERE "ownerId" = ${ownerId}
          FOR UPDATE
        ), debited AS (
          INSERT INTO "daily_credits" ("ownerId","creditDay","region","allocatedCredits","usedCredits","inputTokens","outputTokens","createdAt","updatedAt")
          SELECT ${ownerId}, ${creditDay}, ${region}, ${allocation}::int, ${credits}::int, 0, 0, now(), now()
          WHERE ${credits}::int <= ${allocation}::int
            AND (SELECT "held" FROM wallet) + ${credits}::int <= ${allocation}::int
          ON CONFLICT ("ownerId","creditDay") DO UPDATE SET
            "usedCredits" = "daily_credits"."usedCredits" + ${credits}::int,
            "allocatedCredits" = ${allocation}::int,
            "updatedAt" = now()
          WHERE "daily_credits"."usedCredits" + ${credits}::int <= ${allocation}::int
            AND (SELECT "held" FROM wallet) + ${credits}::int <= ${allocation}::int
          RETURNING "usedCredits"
        )
        INSERT INTO "daily_credit_savings" ("ownerId","credits","remainingCredits","createdAt","updatedAt")
        SELECT ${ownerId}, ${credits}::int, ${credits}::int, now(), now() FROM debited
        ON CONFLICT ("ownerId") DO UPDATE SET
          "credits" = "daily_credit_savings"."credits" + ${credits}::int,
          "remainingCredits" = "daily_credit_savings"."remainingCredits" + ${credits}::int,
          "updatedAt" = now()
        RETURNING "credits","remainingCredits"
      `) as unknown as
        | { rows?: Array<{ credits: number; remainingCredits: number }> }
        | Array<{ credits: number; remainingCredits: number }>;
      const rows = Array.isArray(result) ? result : result.rows ?? [];
      if (rows.length === 0) return { ok: false, reason: "insufficient_credits" };
    } else {
      // Paid source: take from the oldest bundles that still hold credits.
      //
      // The bundles are locked FIRST, so the plan is computed from rows that
      // cannot change underneath it, and Postgres re-reads a locked row's
      // latest committed version - so a concurrent set-aside that already
      // spent a bundle is seen here and the plan shrinks accordingly. Nothing
      // is debited unless the plan covers the whole amount, so the move is
      // all-or-nothing.
      const result = await db.execute(sql`
        WITH locked AS MATERIALIZED (
          SELECT "id", "remainingCredits", "createdAt"
          FROM "credit_purchases"
          WHERE "ownerId" = ${ownerId} AND "remainingCredits" > 0
          ORDER BY "createdAt" ASC, "id" ASC
          FOR UPDATE
        ), eligible AS (
          SELECT "id", "remainingCredits",
                 sum("remainingCredits") OVER (ORDER BY "createdAt" ASC, "id" ASC) AS "running"
          FROM locked
        ), plan AS (
          SELECT "id",
                 LEAST("remainingCredits"::bigint, GREATEST(0::bigint, ${credits}::bigint - ("running" - "remainingCredits")::bigint))::int AS "take"
          FROM eligible
        ), total AS (
          SELECT coalesce(sum("take"), 0)::int AS "total" FROM plan
        ), debited AS (
          UPDATE "credit_purchases" cp
          SET "remainingCredits" = cp."remainingCredits" - plan."take", "updatedAt" = now()
          FROM plan, total
          WHERE cp."id" = plan."id" AND plan."take" > 0
            AND total."total" >= ${credits}::int
            AND cp."remainingCredits" >= plan."take"
          RETURNING cp."id", plan."take"
        )
        INSERT INTO "paid_credit_savings" ("ownerId","credits","remainingCredits","createdAt","updatedAt")
        SELECT ${ownerId}, ${credits}::int, ${credits}::int, now(), now()
        FROM (SELECT coalesce(sum("take"), 0)::int AS "moved" FROM debited) moved
        WHERE moved."moved" = ${credits}::int
        ON CONFLICT ("ownerId") DO UPDATE SET
          "credits" = "paid_credit_savings"."credits" + ${credits}::int,
          "remainingCredits" = "paid_credit_savings"."remainingCredits" + ${credits}::int,
          "updatedAt" = now()
        RETURNING "credits","remainingCredits"
      `) as unknown as
        | { rows?: Array<{ credits: number; remainingCredits: number }> }
        | Array<{ credits: number; remainingCredits: number }>;
      const rows = Array.isArray(result) ? result : result.rows ?? [];
      if (rows.length === 0) return { ok: false, reason: "insufficient_credits" };
    }
  } catch (error) {
    // The migration has not run yet (or the table is gone): the account keeps
    // its credits instead of losing them to a crash.
    if (isMissingRelation(error)) return { ok: false, reason: "savings_unavailable" };
    throw error;
  }
  return { ok: true, balances: await getCreditSavingsForUser(ownerId) };
}

/**
 * Takes credits out of a savings balance, up to what is left in it.
 *
 * The balance row is LOCKED first and the decrement is clamped to what the
 * lock shows, so two requests racing for the same credits cannot drive the
 * balance below zero and cannot take the same credits twice.
 */
async function takeFromSavings(
  ownerId: number,
  source: SavingsSource,
  credits: number
): Promise<{ taken: number; remaining: number }> {
  if (credits <= 0) return { taken: 0, remaining: 0 };
  const db = await requireDb();
  const table = tableNameFor(source);
  const result = await db.execute(sql`
    WITH held AS MATERIALIZED (
      SELECT "remainingCredits" AS "before"
      FROM "${sql.raw(table)}"
      WHERE "ownerId" = ${ownerId}
      FOR UPDATE
    ), debited AS (
      UPDATE "${sql.raw(table)}" s
      SET "remainingCredits" = s."remainingCredits" - LEAST(${credits}::int, s."remainingCredits"), "updatedAt" = now()
      FROM held
      WHERE s."ownerId" = ${ownerId} AND held."before" > 0
      RETURNING s."remainingCredits" AS "after"
    )
    SELECT
      coalesce((SELECT "before" FROM held), 0) - coalesce((SELECT "after" FROM debited), coalesce((SELECT "before" FROM held), 0)) AS "taken",
      coalesce((SELECT "after" FROM debited), coalesce((SELECT "before" FROM held), 0)) AS "remaining"
  `) as unknown as
    | { rows?: Array<{ taken: number; remaining: number }> }
    | Array<{ taken: number; remaining: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const row = rows[0];
  return {
    taken: Number(row?.taken ?? 0),
    remaining: Number(row?.remaining ?? 0),
  };
}

/**
 * Spends one credit from a savings balance.
 *
 * Returns undefined when the account has no savings left.
 */
export async function claimSavingsCreditForUser(
  ownerId: number,
  source: SavingsSource
): Promise<{ remainingCredits: number } | undefined> {
  try {
    const { taken, remaining } = await takeFromSavings(ownerId, source, 1);
    if (taken <= 0) return undefined;
    return { remainingCredits: remaining };
  } catch (error) {
    if (isMissingRelation(error)) return undefined;
    throw error;
  }
}

/**
 * Charges a request's extra usage to the savings balance that funded it.
 *
 * The gateway reserves one credit up front and settles the remainder against
 * the same ledger, so a request funded from savings settles from savings too.
 * A balance that runs dry mid-request leaves the account under-charged, which
 * is reported by the caller.
 */
export async function settleSavingsUsageForUser(
  ownerId: number,
  source: SavingsSource,
  extraCredits: number
): Promise<{ charged: number }> {
  try {
    const { taken } = await takeFromSavings(ownerId, source, extraCredits);
    return { charged: taken };
  } catch (error) {
    if (isMissingRelation(error)) return { charged: 0 };
    throw error;
  }
}
