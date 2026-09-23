/** Central policy for the first-pass Nova credits system. Keep region overrides here as they are introduced. */
export const CREDIT_VALUE_CENTS = 1;
export const DEFAULT_DAILY_CREDITS = 500;
export const DEFAULT_CREDIT_REGION = "global";

const DAILY_CREDITS_BY_REGION: Record<string, number> = {
  global: DEFAULT_DAILY_CREDITS,
};

export function getDailyCreditPolicy(region = DEFAULT_CREDIT_REGION) {
  const normalized = region.trim().toLowerCase() || DEFAULT_CREDIT_REGION;
  return {
    region: normalized,
    dailyCredits: DAILY_CREDITS_BY_REGION[normalized] ?? DEFAULT_DAILY_CREDITS,
  };
}

/** Credits reset at UTC midnight for now; the policy is deliberately isolated for region-aware resets later. */
export function getCreditDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
