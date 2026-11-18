/**
 * The daily allowance for the built-in `generate_image` agent tool.
 *
 * Deliberately separate from `daily_credits`: an image costs one whole
 * generation slot, not token credits, so generating one must never spend the
 * chat balance (and spending credits must never buy images). The counter lives
 * in its own table keyed by `(ownerId, quotaDay)`; that unique index is the
 * conflict target of the atomic claim, so two concurrent tool calls cannot
 * both pass the cap.
 */
import { and, eq, sql } from "drizzle-orm";
import { imageGenerationQuotas } from "../../drizzle/schema";
import {
  getCreditDay,
  type CreditRole,
  type PlanTier,
} from "../credits";
import { requireDb } from "./core";
import { getUserRole } from "./users";
import { getSubscriptionForUser } from "./credits";

/** Free accounts: three generated images per UTC day. */
export const FREE_DAILY_IMAGE_GENERATIONS = 3;
/** Plus: ten per UTC day - still no premium models, just a bigger allowance. */
export const PLUS_DAILY_IMAGE_GENERATIONS = 10;

export type ImageGenerationPolicy = {
  /** Slots per UTC day, or null when the account has no cap. */
  limit: number | null;
  unlimited: boolean;
};

/**
 * The image allowance an account gets: Free 3/day, Plus 10/day, Pro
 * unlimited. Console operators (admin/developer) are unlimited too, matching
 * how the credit policy treats them.
 */
export function getImageGenerationPolicyForAccount(
  role: CreditRole,
  plan: PlanTier
): ImageGenerationPolicy {
  if (role === "developer" || role === "admin")
    return { limit: null, unlimited: true };
  if (plan === "paid") return { limit: null, unlimited: true };
  if (plan === "plus")
    return { limit: PLUS_DAILY_IMAGE_GENERATIONS, unlimited: false };
  return { limit: FREE_DAILY_IMAGE_GENERATIONS, unlimited: false };
}

async function policyForUser(ownerId: number): Promise<ImageGenerationPolicy> {
  const role = await getUserRole(ownerId);
  const plan = (await getSubscriptionForUser(ownerId)).plan;
  return getImageGenerationPolicyForAccount(role, plan);
}

/**
 * Atomically claims one generation slot for the current UTC day. Returns the
 * new usage and the account's cap, or undefined when the day's allowance is
 * already spent (the caller then reports the cap instead of calling the
 * provider). The INSERT ... ON CONFLICT DO UPDATE with the cap in its WHERE
 * clause is the whole guard: the increment and the check are one statement, so
 * parallel calls serialize on the row and at most `limit` of them win.
 */
export async function claimImageGenerationForUser(
  ownerId: number
): Promise<{ usedImages: number; limit: number | null } | undefined> {
  const db = await requireDb();
  const quotaDay = getCreditDay();
  const policy = await policyForUser(ownerId);
  const result = await db.execute(sql`
    INSERT INTO "image_generation_quotas" ("ownerId", "quotaDay", "usedImages", "createdAt", "updatedAt")
    VALUES (${ownerId}, ${quotaDay}, 1, now(), now())
    ON CONFLICT ("ownerId", "quotaDay") DO UPDATE
    SET "usedImages" = "image_generation_quotas"."usedImages" + 1,
        "updatedAt" = now()
    ${
      policy.unlimited
        ? sql``
        : sql`WHERE "image_generation_quotas"."usedImages" < ${policy.limit}`
    }
    RETURNING "usedImages"
  `) as unknown as
    | { rows?: Array<{ usedImages: number }> }
    | Array<{ usedImages: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const claimed = rows[0];
  return claimed
    ? { usedImages: Number(claimed.usedImages), limit: policy.limit }
    : undefined;
}

/**
 * Gives a claimed slot back after the provider call failed. A failed
 * generation must not consume the day's allowance, or a provider outage would
 * lock the user out of a feature they never received. Best effort: the claim
 * was already taken under the same row lock, so this only ever decrements.
 */
export async function releaseImageGenerationClaimForUser(
  ownerId: number
): Promise<void> {
  const db = await requireDb();
  await db.execute(sql`
    UPDATE "image_generation_quotas"
    SET "usedImages" = GREATEST("image_generation_quotas"."usedImages" - 1, 0),
        "updatedAt" = now()
    WHERE "ownerId" = ${ownerId} AND "quotaDay" = ${getCreditDay()}
  `);
}

/** The day's usage and remaining slots, for the tool's own copy. */
export async function getImageGenerationStatusForUser(ownerId: number): Promise<{
  quotaDay: string;
  limit: number | null;
  unlimited: boolean;
  usedImages: number;
  remainingImages: number | null;
}> {
  const db = await requireDb();
  const quotaDay = getCreditDay();
  const policy = await policyForUser(ownerId);
  const [row] = await db
    .select({ usedImages: imageGenerationQuotas.usedImages })
    .from(imageGenerationQuotas)
    .where(
      and(
        eq(imageGenerationQuotas.ownerId, ownerId),
        eq(imageGenerationQuotas.quotaDay, quotaDay)
      )
    )
    .limit(1);
  const usedImages = Number(row?.usedImages ?? 0);
  return {
    quotaDay,
    limit: policy.limit,
    unlimited: policy.unlimited,
    usedImages,
    remainingImages: policy.unlimited
      ? null
      : Math.max(0, (policy.limit ?? 0) - usedImages),
  };
}
