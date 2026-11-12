import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_DAILY_CREDITS, DEFAULT_DAILY_CREDITS, PLUS_DAILY_CREDITS, PRO_DAILY_CREDITS, calculateInferenceCredits, getDailyCreditPolicyForAccount, getTokenCreditRates } from "./credits";

describe("plan-aware daily credit policy", () => {
  it("gives free accounts the default allocation", () => {
    expect(getDailyCreditPolicyForAccount("user", "free")).toEqual({ region: "global", dailyCredits: DEFAULT_DAILY_CREDITS, unlimited: false });
  });

  it("raises the allowance for Plus", () => {
    expect(getDailyCreditPolicyForAccount("user", "plus")).toEqual({ region: "global", dailyCredits: PLUS_DAILY_CREDITS, unlimited: false });
  });

  it("raises the allowance for Pro", () => {
    expect(getDailyCreditPolicyForAccount("user", "paid")).toEqual({ region: "global", dailyCredits: PRO_DAILY_CREDITS, unlimited: false });
  });

  it("keeps admins at least at the admin allocation", () => {
    expect(getDailyCreditPolicyForAccount("admin", "free").dailyCredits).toBe(ADMIN_DAILY_CREDITS);
    expect(getDailyCreditPolicyForAccount("admin", "plus").dailyCredits).toBe(PLUS_DAILY_CREDITS);
  });

  it("marks developers unlimited regardless of plan", () => {
    expect(getDailyCreditPolicyForAccount("developer", "paid")).toEqual({ region: "global", dailyCredits: null, unlimited: true });
  });
});

describe("credit usage pricing", () => {
  const originalRates = process.env.NOVA_CREDIT_RATES_JSON;

  afterEach(() => {
    if (originalRates === undefined) delete process.env.NOVA_CREDIT_RATES_JSON;
    else process.env.NOVA_CREDIT_RATES_JSON = originalRates;
  });

  it("keeps a one-credit floor when providers omit usage", () => {
    expect(calculateInferenceCredits("testco/test-model", null)).toBe(1);
    expect(calculateInferenceCredits("testco/test-model", { total_tokens: 0 })).toBe(1);
  });

  it("charges configured input and output token rates", () => {
    process.env.NOVA_CREDIT_RATES_JSON = JSON.stringify({
      "testco/test-model": { inputCreditsPerMillionTokens: 100, outputCreditsPerMillionTokens: 300 },
    });
    expect(getTokenCreditRates("testco/test-model")).toEqual({
      inputCreditsPerMillionTokens: 100,
      outputCreditsPerMillionTokens: 300,
    });
    expect(calculateInferenceCredits("testco/test-model", { prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 })).toBe(2);
  });
});
