import { and, eq, sql } from "drizzle-orm";
import { dailyCredits, inferenceAllowances } from "../../drizzle/schema";
import { CREDIT_VALUE_CENTS, DEFAULT_CREDIT_REGION, DEFAULT_DAILY_CREDITS, getCreditDay, getDailyCreditPolicyForRole, type InferenceTokenUsage } from "../credits";
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
