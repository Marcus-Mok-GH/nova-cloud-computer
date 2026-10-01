import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_DAILY_CREDITS, DEFAULT_DAILY_CREDITS, calculateInferenceCredits, getDailyCreditPolicyForRole, getTokenCreditRates } from "./credits";

describe("role-based daily credit policy", () => {
  it("gives standard users the default allocation", () => {
    expect(getDailyCreditPolicyForRole("user")).toEqual({ region: "global", dailyCredits: DEFAULT_DAILY_CREDITS, unlimited: false });
  });

  it("gives admins elevated usage", () => {
    expect(getDailyCreditPolicyForRole("admin")).toEqual({ region: "global", dailyCredits: ADMIN_DAILY_CREDITS, unlimited: false });
  });

  it("marks developers unlimited", () => {
    expect(getDailyCreditPolicyForRole("developer")).toEqual({ region: "global", dailyCredits: null, unlimited: true });
  });
});

describe("credit usage pricing", () => {
  const originalRates = process.env.NOVA_CREDIT_RATES_JSON;

  afterEach(() => {
    if (originalRates === undefined) delete process.env.NOVA_CREDIT_RATES_JSON;
    else process.env.NOVA_CREDIT_RATES_JSON = originalRates;
  });

  it("keeps a one-credit floor when providers omit usage", () => {
    expect(calculateInferenceCredits("mistral/test-model", null)).toBe(1);
    expect(calculateInferenceCredits("mistral/test-model", { total_tokens: 0 })).toBe(1);
  });

  it("charges configured input and output token rates", () => {
    process.env.NOVA_CREDIT_RATES_JSON = JSON.stringify({
      "mistral/test-model": { inputCreditsPerMillionTokens: 100, outputCreditsPerMillionTokens: 300 },
    });
    expect(getTokenCreditRates("mistral/test-model")).toEqual({
      inputCreditsPerMillionTokens: 100,
      outputCreditsPerMillionTokens: 300,
    });
    expect(calculateInferenceCredits("mistral/test-model", { prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 })).toBe(2);
  });
});
