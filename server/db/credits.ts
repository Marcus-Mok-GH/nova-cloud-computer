import { and, eq, sql } from "drizzle-orm";
import { dailyCredits, inferenceAllowances, userSubscriptions, whopWebhookEvents } from "../../drizzle/schema";
import { CREDIT_VALUE_CENTS, DEFAULT_CREDIT_REGION, DEFAULT_DAILY_CREDITS, PAID_PLAN_CARRY_OVER_MONTHS, getCarryOverFloorMonth, getCreditDay, getCreditMonth, getDailyCreditPolicyForRole, getMonthlyCreditAllocationForRole, type InferenceTokenUsage, type PlanTier } from "../credits";
import { requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";
import { getUserRole } from "./users";

export async function getInferenceAllowanceForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const allowance = (await db.select().from(inferenceAllowances).where(eq(inferenceAllowances.workspaceId, workspace.id)).limit(1))[0];
  return {
    usedRequests: Number(allowance?.usedRequests ?? 0),
    updatedAt: allowance?.updatedAt ?? null,
  };
}

/**
 * Atomically claim one workspace request only when its configured allowance remains available.
 * `mistral_inference_allowances` is the legacy physical table name for the
 * built-in gateway's allowances; it is referenced verbatim here because the
 * table has not been renamed in the database.
 */
export async function claimInferenceRequestForUser(ownerId: number, maxRequests: number | null) {
  if (maxRequests !== null && (!Number.isInteger(maxRequests) || maxRequests < 1)) return undefined;
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const result = await db.execute(sql`
    INSERT INTO "mistral_inference_allowances" ("workspaceId", "usedRequests", "createdAt", "updatedAt")
    VALUES (${workspace.id}, 1, now(), now())
    ON CONFLICT ("workspaceId") DO UPDATE
    SET "usedRequests" = "mistral_inference_allowances"."usedRequests" + 1,
        "updatedAt" = now()
    ${maxRequests === null ? sql`` : sql`WHERE "mistral_inference_allowances"."usedRequests" < ${maxRequests}`}
    RETURNING "usedRequests"
  `) as unknown as { rows?: Array<{ usedRequests: number }> } | Array<{ usedRequests: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const claimed = rows[0];
  return claimed ? { usedRequests: Number(claimed.usedRequests) } : undefined;
}

export async function getDailyCreditStatusForUser(ownerId: number) {
  const db = await requireDb();
  const creditDay = getCreditDay();
  const [row] = await db.select().from(dailyCredits)
    .where(and(eq(dailyCredits.ownerId, ownerId), eq(dailyCredits.creditDay, creditDay)))
    .limit(1);
  const role = await getUserRole(ownerId);
  const policy = getDailyCreditPolicyForRole(role, row?.region ?? DEFAULT_CREDIT_REGION);
  const storedAllocation = Number(row?.allocatedCredits ?? policy.dailyCredits);
  // A developer is unlimited; an admin always gets the elevated allocation;
  // everyone else keeps the allocation recorded on their row (or the policy).
  const dailyCreditsTotal = policy.unlimited
    ? null
    : role === "admin"
      ? policy.dailyCredits ?? storedAllocation
      : storedAllocation;
  const usedCredits = Number(row?.usedCredits ?? 0);
  return {
    region: policy.region,
    creditDay,
    unlimited: policy.unlimited,
    dailyCredits: dailyCreditsTotal,
    usedCredits,
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    remainingCredits: dailyCreditsTotal === null ? null : Math.max(0, dailyCreditsTotal - usedCredits),
    creditValueCents: CREDIT_VALUE_CENTS,
  };
}

/** Atomically claim one built-in inference credit for the current UTC day. A
 * developer is unlimited: the claim always succeeds and records usage without
 * a cap. */
export async function claimDailyCreditForUser(ownerId: number) {
  const db = await requireDb();
  const creditDay = getCreditDay();
  const role = await getUserRole(ownerId);
  const policy = getDailyCreditPolicyForRole(role);
  // The stored allocation is only a record-keeping value for an unlimited
  // developer, so keep it at the standard size in case the role changes later.
  const storedAllocation = policy.unlimited ? DEFAULT_DAILY_CREDITS : policy.dailyCredits ?? DEFAULT_DAILY_CREDITS;
  // A limited claim only succeeds while usage is under the role's allocation;
  // an unlimited claim has no cap. Elevating a limited account refreshes the
  // row's allocation to the role policy so the raised cap takes effect today.
  const capClause = policy.unlimited
    ? sql``
    : role === "admin"
      ? sql`WHERE "daily_credits"."usedCredits" < ${storedAllocation}`
      : sql`WHERE "daily_credits"."usedCredits" < "daily_credits"."allocatedCredits"`;
  const allocationSet = role === "user" ? sql`` : sql`, "allocatedCredits" = ${storedAllocation}`;
  const result = await db.execute(sql`
    INSERT INTO "daily_credits" ("ownerId", "creditDay", "region", "allocatedCredits", "usedCredits", "createdAt", "updatedAt")
    VALUES (${ownerId}, ${creditDay}, ${policy.region}, ${storedAllocation}, 1, now(), now())
    ON CONFLICT ("ownerId", "creditDay") DO UPDATE
    SET "usedCredits" = "daily_credits"."usedCredits" + 1${allocationSet},
        "updatedAt" = now()
    ${capClause}
    RETURNING "usedCredits", "allocatedCredits"
  `) as unknown as { rows?: Array<{ usedCredits: number; allocatedCredits: number }> } | Array<{ usedCredits: number; allocatedCredits: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const claimed = rows[0];
  return claimed ? { usedCredits: Number(claimed.usedCredits), allocatedCredits: Number(claimed.allocatedCredits) } : undefined;
}

/** Records provider token usage and adds any cost above the one-credit preflight reservation. */
export async function settleDailyCreditUsageForUser(ownerId: number, chargedCredits: number, usage: InferenceTokenUsage) {
  const db = await requireDb();
  const creditDay = getCreditDay();
  const additionalCredits = Math.max(0, Math.ceil(chargedCredits) - 1);
  const inputValue = Number(usage?.prompt_tokens ?? 0);
  const outputValue = Number(usage?.completion_tokens ?? 0);
  const inputTokens = Number.isFinite(inputValue) ? Math.max(0, Math.floor(inputValue)) : 0;
  const outputTokens = Number.isFinite(outputValue) ? Math.max(0, Math.floor(outputValue)) : 0;
  const result = await db.execute(sql`
    UPDATE "daily_credits"
    SET "usedCredits" = "daily_credits"."usedCredits" + ${additionalCredits},
        "inputTokens" = "daily_credits"."inputTokens" + ${inputTokens},
        "outputTokens" = "daily_credits"."outputTokens" + ${outputTokens},
        "updatedAt" = now()
    WHERE "ownerId" = ${ownerId} AND "creditDay" = ${creditDay}
    RETURNING "usedCredits", "inputTokens", "outputTokens"
  `) as unknown as { rows?: Array<{ usedCredits: number; inputTokens: number; outputTokens: number }> } | Array<{ usedCredits: number; inputTokens: number; outputTokens: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const settled = rows[0];
  return settled ? { usedCredits: Number(settled.usedCredits), inputTokens: Number(settled.inputTokens), outputTokens: Number(settled.outputTokens) } : undefined;
}

/* ------------------------------------------------------------------------- *
 * Paid plan ledger (Nova Pro)
 *
 * A paid subscription allocates `PAID_PLAN_MONTHLY_CREDITS` at the start of
 * each UTC month. Nothing expires at the month boundary: the spendable balance
 * is the sum of unspent allocation across every month still inside the
 * carry-over window, spent oldest-first.
 * ------------------------------------------------------------------------- */

export type SubscriptionSummary = {
  plan: PlanTier;
  status: string;
  provider: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  whopCheckoutConfigId: string | null;
};

function isSubscriptionActive(status: string, periodEnd: Date | null) {
  if (status !== "active" && status !== "trialing") return false;
  return periodEnd === null || periodEnd.getTime() > Date.now();
}

/** The owner's subscription as billing and plan gating should see it. */
export async function getSubscriptionForUser(ownerId: number): Promise<SubscriptionSummary> {
  const db = await requireDb();
  const [row] = await db.select().from(userSubscriptions).where(eq(userSubscriptions.ownerId, ownerId)).limit(1);
  if (!row) {
    return { plan: "free", status: "inactive", provider: "whop", currentPeriodEnd: null, cancelAtPeriodEnd: false, whopCheckoutConfigId: null };
  }
  const periodEnd = row.currentPeriodEnd ?? null;
  const active = row.plan === "paid" && isSubscriptionActive(row.status, periodEnd);
  return {
    plan: active ? "paid" : "free",
    status: row.status,
    provider: row.provider,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    whopCheckoutConfigId: row.whopCheckoutConfigId ?? null,
  };
}

/** Whether the owner is entitled to the paid plan right now. */
export async function isPaidPlanForUser(ownerId: number) {
  return (await getSubscriptionForUser(ownerId)).plan === "paid";
}

/**
 * Creates (or raises) the current month's allocation for a paid owner. Safe to
 * call repeatedly: the row is keyed by (ownerId, creditMonth) and the stored
 * allocation never shrinks.
 */
export async function ensureMonthlyAllocationForUser(ownerId: number) {
  const role = await getUserRole(ownerId);
  const allocation = getMonthlyCreditAllocationForRole(role);
  if (allocation === null) return null;
  const db = await requireDb();
  const creditMonth = getCreditMonth();
  const result = await db.execute(sql`
    INSERT INTO "monthly_credits" ("ownerId", "creditMonth", "allocatedCredits", "usedCredits", "createdAt", "updatedAt")
    VALUES (${ownerId}, ${creditMonth}, ${allocation}, 0, now(), now())
    ON CONFLICT ("ownerId", "creditMonth") DO UPDATE
    SET "allocatedCredits" = GREATEST("monthly_credits"."allocatedCredits", ${allocation}),
        "updatedAt" = now()
    RETURNING "allocatedCredits", "usedCredits"
  `) as unknown as { rows?: Array<{ allocatedCredits: number; usedCredits: number }> } | Array<{ allocatedCredits: number; usedCredits: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const row = rows[0];
  return row ? { allocatedCredits: Number(row.allocatedCredits), usedCredits: Number(row.usedCredits) } : null;
}

type MonthlyCreditRow = { creditMonth: string; allocatedCredits: number; usedCredits: number };

export type MonthlyCreditStatus = {
  plan: PlanTier;
  creditMonth: string;
  monthlyAllocation: number;
  balanceCredits: number;
  usedCreditsThisMonth: number;
  carriedOverCredits: number;
  carryOverMonths: number;
  inputTokens: number;
  outputTokens: number;
  creditValueCents: number;
};

/** Spendable paid-plan balance, including unspent credits carried over. */
export async function getMonthlyCreditStatusForUser(ownerId: number): Promise<MonthlyCreditStatus> {
  const subscription = await getSubscriptionForUser(ownerId);
  const creditMonth = getCreditMonth();
  const base = {
    plan: subscription.plan,
    creditMonth,
    monthlyAllocation: 0,
    balanceCredits: 0,
    usedCreditsThisMonth: 0,
    carriedOverCredits: 0,
    carryOverMonths: PAID_PLAN_CARRY_OVER_MONTHS,
    inputTokens: 0,
    outputTokens: 0,
    creditValueCents: CREDIT_VALUE_CENTS,
  };
  if (subscription.plan !== "paid") return base;
  const current = await ensureMonthlyAllocationForUser(ownerId);
  if (current === null) return base;
  const db = await requireDb();
  const floor = getCarryOverFloorMonth(creditMonth);
  const result = await db.execute(sql`
    SELECT "creditMonth", "allocatedCredits", "usedCredits", "inputTokens", "outputTokens"
    FROM "monthly_credits"
    WHERE "ownerId" = ${ownerId} AND "creditMonth" >= ${floor}
    ORDER BY "creditMonth" ASC
  `) as unknown as { rows?: Array<MonthlyCreditRow & { inputTokens: number; outputTokens: number }> } | Array<MonthlyCreditRow & { inputTokens: number; outputTokens: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  let balance = 0;
  let usedThisMonth = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of rows) {
    const allocated = Number(row.allocatedCredits);
    const used = Number(row.usedCredits);
    balance += Math.max(0, allocated - used);
    if (row.creditMonth === creditMonth) {
      usedThisMonth = used;
      inputTokens = Number(row.inputTokens);
      outputTokens = Number(row.outputTokens);
    }
  }
  return {
    ...base,
    monthlyAllocation: current.allocatedCredits,
    balanceCredits: balance,
    usedCreditsThisMonth: usedThisMonth,
    carriedOverCredits: Math.max(0, balance - Math.max(0, current.allocatedCredits - current.usedCredits)),
    inputTokens,
    outputTokens,
  };
}

/**
 * Atomically spends one credit from the oldest month that still has room, so
 * carried-over credits are used before the current month's allocation.
 * Returns undefined when the paid balance is exhausted.
 */
export async function claimMonthlyCreditForUser(ownerId: number) {
  const current = await ensureMonthlyAllocationForUser(ownerId);
  if (current === null) return undefined;
  const db = await requireDb();
  const floor = getCarryOverFloorMonth(getCreditMonth());
  const result = await db.execute(sql`
    SELECT "creditMonth" FROM "monthly_credits"
    WHERE "ownerId" = ${ownerId} AND "creditMonth" >= ${floor} AND "usedCredits" < "allocatedCredits"
    ORDER BY "creditMonth" ASC
  `) as unknown as { rows?: Array<{ creditMonth: string }> } | Array<{ creditMonth: string }>;
  const candidates = (Array.isArray(result) ? result : result.rows ?? []).map(row => row.creditMonth);
  for (const creditMonth of candidates) {
    const claimed = await db.execute(sql`
      UPDATE "monthly_credits"
      SET "usedCredits" = "monthly_credits"."usedCredits" + 1, "updatedAt" = now()
      WHERE "ownerId" = ${ownerId} AND "creditMonth" = ${creditMonth} AND "usedCredits" < "allocatedCredits"
      RETURNING "usedCredits", "allocatedCredits", "creditMonth"
    `) as unknown as { rows?: Array<{ usedCredits: number; allocatedCredits: number; creditMonth: string }> } | Array<{ usedCredits: number; allocatedCredits: number; creditMonth: string }>;
    const rows = Array.isArray(claimed) ? claimed : claimed.rows ?? [];
    const row = rows[0];
    if (row) {
      return {
        creditMonth: row.creditMonth,
        usedCredits: Number(row.usedCredits),
        allocatedCredits: Number(row.allocatedCredits),
      };
    }
  }
  return undefined;
}

/** Records provider token usage and any cost above the one-credit reservation. */
export async function settleMonthlyCreditUsageForUser(ownerId: number, chargedCredits: number, usage: InferenceTokenUsage) {
  await ensureMonthlyAllocationForUser(ownerId);
  const db = await requireDb();
  const creditMonth = getCreditMonth();
  const additionalCredits = Math.max(0, Math.ceil(chargedCredits) - 1);
  const inputValue = Number(usage?.prompt_tokens ?? 0);
  const outputValue = Number(usage?.completion_tokens ?? 0);
  const inputTokens = Number.isFinite(inputValue) ? Math.max(0, Math.floor(inputValue)) : 0;
  const outputTokens = Number.isFinite(outputValue) ? Math.max(0, Math.floor(outputValue)) : 0;
  const result = await db.execute(sql`
    UPDATE "monthly_credits"
    SET "usedCredits" = "monthly_credits"."usedCredits" + ${additionalCredits},
        "inputTokens" = "monthly_credits"."inputTokens" + ${inputTokens},
        "outputTokens" = "monthly_credits"."outputTokens" + ${outputTokens},
        "updatedAt" = now()
    WHERE "ownerId" = ${ownerId} AND "creditMonth" = ${creditMonth}
    RETURNING "usedCredits", "inputTokens", "outputTokens"
  `) as unknown as { rows?: Array<{ usedCredits: number; inputTokens: number; outputTokens: number }> } | Array<{ usedCredits: number; inputTokens: number; outputTokens: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const settled = rows[0];
  return settled ? { usedCredits: Number(settled.usedCredits), inputTokens: Number(settled.inputTokens), outputTokens: Number(settled.outputTokens) } : undefined;
}

/* -------------------------------------------------------------------------
 * Whop subscription writes
 *
 * Whop is the payment provider: a checkout configuration is created per
 * account, and membership webhooks drive the local subscription row that the
 * credit ledger and model gating read. Writes are upserts so a replayed
 * webhook converges on the same state instead of creating duplicates.
 * ------------------------------------------------------------------------- */

export type WhopSubscriptionState = {
  plan: SubscriptionSummary["plan"];
  status: string;
  whopMembershipId: string | null;
  whopUserId: string | null;
  whopCheckoutConfigId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/** Writes the provider's membership state and returns the resolved summary. */
export async function upsertSubscriptionForUser(ownerId: number, state: WhopSubscriptionState): Promise<SubscriptionSummary> {
  const db = await requireDb();
  const now = new Date();
  await db
    .insert(userSubscriptions)
    .values({
      ownerId,
      plan: state.plan,
      status: state.status,
      provider: "whop",
      whopMembershipId: state.whopMembershipId,
      whopUserId: state.whopUserId,
      whopCheckoutConfigId: state.whopCheckoutConfigId,
      currentPeriodStart: state.currentPeriodStart,
      currentPeriodEnd: state.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSubscriptions.ownerId,
      set: {
        plan: state.plan,
        status: state.status,
        provider: "whop",
        whopMembershipId: sql`COALESCE(${state.whopMembershipId}, "user_subscriptions"."whopMembershipId")`,
        whopUserId: sql`COALESCE(${state.whopUserId}, "user_subscriptions"."whopUserId")`,
        whopCheckoutConfigId: sql`COALESCE(${state.whopCheckoutConfigId}, "user_subscriptions"."whopCheckoutConfigId")`,
        currentPeriodStart: state.currentPeriodStart,
        currentPeriodEnd: state.currentPeriodEnd,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        updatedAt: now,
      },
    });
  return getSubscriptionForUser(ownerId);
}

/** Remembers the Whop checkout configuration created for this account. */
export async function setWhopCheckoutConfigIdForUser(ownerId: number, checkoutConfigId: string) {
  const db = await requireDb();
  await db
    .insert(userSubscriptions)
    .values({ ownerId, plan: "free", status: "inactive", provider: "whop", whopCheckoutConfigId: checkoutConfigId, cancelAtPeriodEnd: false, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSubscriptions.ownerId,
      set: { whopCheckoutConfigId: checkoutConfigId, updatedAt: new Date() },
    });
  return checkoutConfigId;
}

/**
 * Records a webhook delivery. Returns false when the event id was already
 * stored, so the caller can acknowledge Whop's retry without re-applying it.
 */
export async function recordWhopWebhookEvent(eventId: string, eventType: string | null, membershipId: string | null) {
  const db = await requireDb();
  const inserted = await db
    .insert(whopWebhookEvents)
    .values({ eventId, eventType, membershipId })
    .onConflictDoNothing({ target: whopWebhookEvents.eventId })
    .returning({ id: whopWebhookEvents.id });
  return inserted.length > 0;
}

/** Resolves which Nova account owns a Whop membership, if any. */
export async function getOwnerIdForWhopMembership(membershipId: string) {
  const db = await requireDb();
  const [row] = await db
    .select({ ownerId: userSubscriptions.ownerId })
    .from(userSubscriptions)
    .where(eq(userSubscriptions.whopMembershipId, membershipId))
    .limit(1);
  return row?.ownerId ?? null;
}
/**
 * Called when a Whop subscription becomes active.
 * Creates the paid subscription row and allocates the current month's credits.
 */
export async function grantPremiumSubscription(
  ownerId: number,
  membershipId: string,
  planId: string,
  currentPeriodEnd: Date
) {
  return upsertSubscriptionForUser(ownerId, {
    plan: "paid",
    status: "active",
    whopMembershipId: membershipId,
    whopUserId: null,
    whopCheckoutConfigId: null,
    currentPeriodStart: new Date(currentPeriodEnd.getTime() - 30 * 24 * 60 * 60 * 1000),
    currentPeriodEnd,
    cancelAtPeriodEnd: false,
  });
}

/**
 * Called when a Whop subscription is cancelled or expires.
 * Downgrades the user to free plan.
 */
export async function revokePremiumSubscription(ownerId: number, membershipId: string) {
  return upsertSubscriptionForUser(ownerId, {
    plan: "free",
    status: "cancelled",
    whopMembershipId: membershipId,
    whopUserId: null,
    whopCheckoutConfigId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
}
