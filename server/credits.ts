/** Central policy for Nova credits. Rates can be replaced per model without changing billing flow. */
export const CREDIT_VALUE_CENTS = 1;
export const DEFAULT_DAILY_CREDITS = 500;
/** Admins get elevated usage: a higher daily allocation than a standard account. */
export const ADMIN_DAILY_CREDITS = 1000;
export const DEFAULT_CREDIT_REGION = "global";
export const MINIMUM_INFERENCE_CREDITS = 1;

/** Role names as stored in the `user_role` enum, ordered from lowest to highest privilege. */
export type CreditRole = "user" | "admin" | "developer";

/**
 * A developer has unlimited Nova credits. The stored allocation for a
 * developer's ledger row only needs a value to satisfy the not-null column; it
 * is never compared against usage because unlimited claims skip the cap.
 */
export const UNLIMITED_CREDITS_ALLOCATION = 1_000_000_000;

export type InferenceTokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | null | undefined;

export type TokenCreditRates = {
  inputCreditsPerMillionTokens: number;
  outputCreditsPerMillionTokens: number;
};

const DAILY_CREDITS_BY_REGION: Record<string, number> = {
  global: DEFAULT_DAILY_CREDITS,
};

// One credit equals one cent. Override these defaults with NOVA_CREDIT_RATES_JSON
// when the provider's current per-model prices are known.
const DEFAULT_TOKEN_CREDIT_RATES: TokenCreditRates = {
  inputCreditsPerMillionTokens: 100,
  outputCreditsPerMillionTokens: 300,
};

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function validRate(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Optional JSON keyed by model ID, with a default entry for unmatched models. */
export function getTokenCreditRates(modelId?: string): TokenCreditRates {
  const fallback = DEFAULT_TOKEN_CREDIT_RATES;
  const raw = process.env.NOVA_CREDIT_RATES_JSON?.trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidate = (modelId && parsed[modelId]) ?? parsed.default;
    if (!candidate || typeof candidate !== "object") return fallback;
    const rates = candidate as Record<string, unknown>;
    return {
      inputCreditsPerMillionTokens: validRate(rates.inputCreditsPerMillionTokens, fallback.inputCreditsPerMillionTokens),
      outputCreditsPerMillionTokens: validRate(rates.outputCreditsPerMillionTokens, fallback.outputCreditsPerMillionTokens),
    };
  } catch {
    return fallback;
  }
}

export function getDailyCreditPolicy(region = DEFAULT_CREDIT_REGION) {
  const normalized = region.trim().toLowerCase() || DEFAULT_CREDIT_REGION;
  return { region: normalized, dailyCredits: DAILY_CREDITS_BY_REGION[normalized] ?? DEFAULT_DAILY_CREDITS };
}

/**
 * Daily credit policy for an account's role. A developer is unlimited
 * (`dailyCredits: null`); an admin gets `ADMIN_DAILY_CREDITS`; everyone else
 * gets the region's standard allocation.
 */
export function getDailyCreditPolicyForRole(role: CreditRole, region = DEFAULT_CREDIT_REGION) {
  const base = getDailyCreditPolicy(region);
  if (role === "developer") return { region: base.region, dailyCredits: null, unlimited: true } as const;
  if (role === "admin") return { region: base.region, dailyCredits: ADMIN_DAILY_CREDITS, unlimited: false } as const;
  return { region: base.region, dailyCredits: base.dailyCredits, unlimited: false } as const;
}

/** Credits reset at UTC midnight for now; the policy is deliberately isolated for region-aware resets later. */
export function getCreditDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Converts provider-reported usage into whole cents/credits, with a one-credit floor. */
export function calculateInferenceCredits(modelId: string | undefined, usage: InferenceTokenUsage) {
  const promptTokens = positiveInteger(usage?.prompt_tokens);
  const completionTokens = positiveInteger(usage?.completion_tokens);
  const totalTokens = positiveInteger(usage?.total_tokens);
  const inputTokens = promptTokens || Math.max(0, totalTokens - completionTokens);
  const outputTokens = completionTokens || Math.max(0, totalTokens - inputTokens);
  if (inputTokens === 0 && outputTokens === 0) return MINIMUM_INFERENCE_CREDITS;
  const rates = getTokenCreditRates(modelId);
  const rawCredits = (inputTokens * rates.inputCreditsPerMillionTokens + outputTokens * rates.outputCreditsPerMillionTokens) / 1_000_000;
  return Math.max(MINIMUM_INFERENCE_CREDITS, Math.ceil(rawCredits));
}

/* ------------------------------------------------------------------------- *
 * Paid plan (Nova Pro)
 *
 * A paid plan grants a monthly credit pool instead of the free daily
 * allocation. Unused credits carry over: the balance is the sum of every
 * month's unspent allocation, so nothing expires at the month boundary.
 * ------------------------------------------------------------------------- */

/** Monthly credit allocation for an active paid subscription. */
export const PAID_PLAN_MONTHLY_CREDITS = 10_000;

/** Price of the monthly subscription, in cents (USD): $7.99. */
export const PAID_PLAN_PRICE_CENTS = 799;

export const PAID_PLAN_CURRENCY = "usd";

/** How many months of unspent credit a paid account may accumulate. */
export const PAID_PLAN_CARRY_OVER_MONTHS = 12;

export type PlanTier = "free" | "paid";

/**
 * The credit month key (`YYYY-MM`, UTC). Monthly allocations are created under
 * this key, exactly as `getCreditDay` keys the free daily ledger.
 */
export function getCreditMonth(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

/** First instant of the month after `now`, used to date the next allocation. */
export function getNextCreditMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** `YYYY-MM` for an offset in months from the given date (negative = past). */
export function shiftCreditMonth(month: string, offset: number) {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!year || !monthIndex) return month;
  const shifted = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
  return getCreditMonth(shifted);
}

/**
 * Whole months between two credit-month keys. Used to decide whether a paid
 * account lapsed long enough to exhaust the carry-over window.
 */
export function monthsBetweenCreditMonths(from: string, to: string) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  if (!fromYear || !fromMonth || !toYear || !toMonth) return 0;
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * The oldest credit month that still counts toward a balance at `month`.
 * Anything older has fallen outside the carry-over window and is not spendable.
 */
export function getCarryOverFloorMonth(month: string) {
  return shiftCreditMonth(month, -(PAID_PLAN_CARRY_OVER_MONTHS - 1));
}

/** A paid plan's monthly allowance, by role. Admins and developers keep their elevated access. */
export function getMonthlyCreditAllocationForRole(role: CreditRole) {
  if (role === "developer") return null;
  if (role === "admin") return Math.max(ADMIN_DAILY_CREDITS, PAID_PLAN_MONTHLY_CREDITS);
  return PAID_PLAN_MONTHLY_CREDITS;
}
