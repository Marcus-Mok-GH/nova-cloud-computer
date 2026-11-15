import { describe, expect, it } from "vitest";
import {
  creditsToDollars,
  dollarsToCredits,
  formatCredits,
  formatDollars,
} from "./money";

describe("money (credits presented as dollars)", () => {
  it("converts at the flat top-up rate: 1,000 credits = $1", () => {
    expect(creditsToDollars(1_000)).toBe(1);
    expect(creditsToDollars(500)).toBe(0.5);
    expect(creditsToDollars(10_000)).toBe(10);
    expect(dollarsToCredits(1)).toBe(1_000);
    expect(dollarsToCredits(0.5)).toBe(500);
    expect(dollarsToCredits(2.5)).toBe(2_500);
  });

  it("rounds dollar input to whole credits (one thousandth)", () => {
    expect(dollarsToCredits(0.0014)).toBe(1);
    expect(dollarsToCredits(0.0004)).toBe(0);
  });

  it("formats plain-$ money with two decimals", () => {
    expect(formatDollars(0.5)).toBe("$0.50");
    expect(formatDollars(10)).toBe("$10.00");
    expect(formatDollars(1234.5)).toBe("$1,234.50");
  });

  it("formats credit counts as dollars", () => {
    expect(formatCredits(500)).toBe("$0.50");
    expect(formatCredits(5_000)).toBe("$5.00");
    expect(formatCredits(10_000)).toBe("$10.00");
    expect(formatCredits(0)).toBe("$0.00");
  });

  it("honours the caller's locale for grouping and decimals", () => {
    expect(formatCredits(1_234_500, "de-DE")).toBe("$1.234,50");
  });
});
