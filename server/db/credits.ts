import { and, eq, sql } from "drizzle-orm";
import { dailyCredits, inferenceAllowances, userSubscriptions, users, whopWebhookEvents } from "../../drizzle/schema";
import { CREDIT_VALUE_CENTS, DEFAULT_CREDIT_REGION, DEFAULT_DAILY_CREDITS, FREE_TRIAL_DAYS, getCreditDay, getDailyCreditPolicyForAccount, type InferenceTokenUsage, type PlanTier } from "../credits";
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
  const plan = (await getSubscriptionForUser(ownerId)).plan;
  const policy = getDailyCreditPolicyForAccount(role, plan, row?.region ?? DEFAULT_CREDIT_REGION);
  const dailyCreditsTotal = policy.unlimited ? null : policy.dailyCredits ?? Number(row?.allocatedCredits ?? DEFAULT_DAILY_CREDITS);
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

/** Atomically claim one built-in inference credit for the current UTC day. The
 * allowance comes from the account's plan (free / plus / pro), elevated by the
 * role. A developer is unlimited: the claim always succeeds and records usage
 * without a cap. */
export async function claimDailyCreditForUser(ownerId: number) {
  const db = await requireDb();
  const creditDay = getCreditDay();
  const role = await getUserRole(ownerId);
  const plan = (await getSubscriptionForUser(ownerId)).plan;
  const policy = getDailyCreditPolicyForAccount(role, plan);
  // The stored allocation is only a record-keeping value for an unlimited
  // developer, so keep it at the standard size in case the role changes later.
  const storedAllocation = policy.unlimited ? DEFAULT_DAILY_CREDITS : policy.dailyCredits ?? DEFAULT_DAILY_CREDITS;
  // The allocation is refreshed on every claim so a plan change (free -> plus
  // -> pro, or an elevation) takes effect the same day. A limited claim only
  // succeeds while usage is under that allowance; an unlimited claim has no cap.
  const result = await db.execute(sql`
    INSERT INTO "daily_credits" ("ownerId", "creditDay", "region", "allocatedCredits", "usedCredits", "createdAt", "updatedAt")
    VALUES (${ownerId}, ${creditDay}, ${policy.region}, ${storedAllocation}, 1, now(), now())
    ON CONFLICT ("ownerId", "creditDay") DO UPDATE
    SET "usedCredits" = "daily_credits"."usedCredits" + 1,
        "allocatedCredits" = ${storedAllocation},
        "updatedAt" = now()
    ${policy.unlimited ? sql`` : sql`WHERE "daily_credits"."usedCredits" < ${storedAllocation}`}
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

/* -------------------------------------------------------------------------
 * Subscription ledger
 *
 * Whop membership webhooks drive the single `user_subscriptions` row; the
 * tier stored there selects the daily allowance (`daily_credits`) the account
 * spends from. There is no monthly pool any more - every tier replenishes at
 * UTC midnight.
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
  const active = isSubscriptionActive(row.status, periodEnd);
  const plan: PlanTier = !active ? "free" : row.plan === "paid" ? "paid" : row.plan === "plus" ? "plus" : "free";
  return {
    plan,
    status: row.status,
    provider: row.provider,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    whopCheckoutConfigId: row.whopCheckoutConfigId ?? null,
  };
}

/**
 * Whether the owner may use every Nova Pro feature right now: an active
 * paid plan, or a console-operator role. Operators hold the Admin tier, so
 * Pro features unlock for them regardless of their subscription. This is
 * the feature gate; Plus deliberately does not count - it buys credits only.
 */
export async function hasProAccessForUser(ownerId: number) {
  const role = await getUserRole(ownerId);
  if (role === "admin" || role === "developer") return true;
  return (await getSubscriptionForUser(ownerId)).plan === "paid";
}

const DAY_MS = 86_400_000;

/**
 * The free plan's trial window: a standard account can use Nova for
 * `FREE_TRIAL_DAYS` days from the moment it was created. Pro access (a paid
 * plan or a console-operator role) is not bounded by the clock, so this
 * predicate only ever decides the fate of standard accounts.
 */
export async function isFreeTrialActiveForUser(ownerId: number): Promise<boolean> {
  const db = await requireDb();
  const [row] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, ownerId)).limit(1);
  // Fail open: a missing row is a data anomaly, never a reason to lock an
  // account out of its own workspace.
  if (!row?.createdAt) return true;
  return row.createdAt.getTime() + FREE_TRIAL_DAYS * DAY_MS > Date.now();
}

/** The instant the account's free trial ends (createdAt + 14 days), or null
 * when the account row is missing. Purely informational for the billing UI. */
export async function getFreeTrialEndsAtForUser(ownerId: number): Promise<Date | null> {
  const db = await requireDb();
  const [row] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, ownerId)).limit(1);
  return row?.createdAt ? new Date(row.createdAt.getTime() + FREE_TRIAL_DAYS * DAY_MS) : null;
}

/**
 * Whether the owner may use Nova at all right now: a Plus or paid plan, a
 * console-operator role, or a standard account still inside its 14-day free
 * trial. Once the trial closes, the account must upgrade - the free plan is
 * a trial, not a forever tier.
 */
export async function hasActiveAccessForUser(ownerId: number): Promise<boolean> {
  const plan = (await getSubscriptionForUser(ownerId)).plan;
  if (plan === "plus") return true;
  if (await hasProAccessForUser(ownerId)) return true; // a paid plan or a console-operator role
  return isFreeTrialActiveForUser(ownerId);
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
