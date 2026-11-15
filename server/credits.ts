/** Central policy for Nova credits. Rates can be replaced per model without changing billing flow. */
export const CREDIT_VALUE_CENTS = 1;
export const DEFAULT_DAILY_CREDITS = 500;
/** Plus (S$4.99/month) raises the daily allowance only - no premium models. */
export const PLUS_DAILY_CREDITS = 5_000;
/** Nova Pro (S$7.99/month) allowance, replenished every UTC day. */
export const PRO_DAILY_CREDITS = 10_000;
/** Admins get elevated usage: a higher daily allocation than a standard account. */
export const ADMIN_DAILY_CREDITS = 1000;
export const DEFAULT_CREDIT_REGION = "global";
export const MINIMUM_INFERENCE_CREDITS = 1;
/**
 * The free plan is a trial, not a forever tier: a standard account (no paid
 * plan, no console-operator role) can use Nova for this many days from the
 * moment the account was created, after which it must upgrade to Nova Pro.
 */
export const FREE_TRIAL_DAYS = 14;

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
 * The daily allowance a plan grants, regardless of role.
 */
export function getDailyCreditPolicyForPlan(plan: PlanTier) {
  if (plan === "paid") return PRO_DAILY_CREDITS;
  if (plan === "plus") return PLUS_DAILY_CREDITS;
  return DEFAULT_DAILY_CREDITS;
}

/**
 * Daily credit policy for an account: the plan sets the allowance and the role
 * only elevates it (admins get at least `ADMIN_DAILY_CREDITS`, developers are
 * unlimited).
 */
export function getDailyCreditPolicyForAccount(role: CreditRole, plan: PlanTier, region = DEFAULT_CREDIT_REGION) {
  const base = getDailyCreditPolicy(region);
  if (role === "developer") return { region: base.region, dailyCredits: null, unlimited: true } as const;
  const planDaily = getDailyCreditPolicyForPlan(plan);
  if (role === "admin") return { region: base.region, dailyCredits: Math.max(ADMIN_DAILY_CREDITS, planDaily), unlimited: false } as const;
  return { region: base.region, dailyCredits: planDaily, unlimited: false } as const;
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
 * Plans
 *
 * Every tier draws from the same daily ledger (`daily_credits`), replenished at
 * UTC midnight. Free is the trial tier, Plus raises the allowance only, and
 * Nova Pro raises it further and unlocks the premium models on top.
 * ------------------------------------------------------------------------- */

/** Price of the Plus subscription, in cents (SGD): S$4.99. */
export const PLUS_PLAN_PRICE_CENTS = 499;

/** Price of the Pro subscription, in cents (SGD): S$7.99. */
export const PAID_PLAN_PRICE_CENTS = 799;

export const PAID_PLAN_CURRENCY = "sgd";

export type PlanTier = "free" | "plus" | "paid";
