import { describe, expect, it } from "vitest";
import {
  CREDITS_PER_CURRENCY_UNIT,
  CREDIT_TOPUP_CURRENCY,
  CREDIT_TOPUP_PRODUCTS,
  formatCreditTopUpPrice,
  getCreditTopUpProduct,
} from "./creditTopUps";

/**
 * The ladder is the single source of truth for money: the server builds its
 * checkout from it and the webhook grants from it. These pin the properties the
 * billing flow depends on, so a mistyped rung cannot ship.
 */
describe("credit top-up catalog", () => {
  it("offers the ladder from S$5 to S$50", () => {
    const prices = CREDIT_TOPUP_PRODUCTS.map(p => p.priceCents);
    expect(prices[0]).toBe(500);
    expect(prices[prices.length - 1]).toBe(5_000);
    expect(CREDIT_TOPUP_PRODUCTS).toHaveLength(6);
  });

  it("charges a flat rate - every bundle is CREDITS_PER_CURRENCY_UNIT per unit", () => {
    for (const product of CREDIT_TOPUP_PRODUCTS) {
      expect(product.credits).toBe((product.priceCents / 100) * CREDITS_PER_CURRENCY_UNIT);
    }
  });

  it("prices in ascending order with unique ids", () => {
    const prices = CREDIT_TOPUP_PRODUCTS.map(p => p.priceCents);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    const ids = CREDIT_TOPUP_PRODUCTS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prices in the same currency as the subscription", () => {
    expect(CREDIT_TOPUP_CURRENCY).toBe("sgd");
  });

  it("resolves a bundle by id and rejects an unknown one", () => {
    expect(getCreditTopUpProduct("topup-10")).toEqual({ id: "topup-10", priceCents: 1_000, credits: 10_000 });
    // An id that is not on the ladder must never resolve - the webhook relies on
    // this to refuse granting credits for an unrecognised product.
    expect(getCreditTopUpProduct("topup-1000")).toBeUndefined();
    expect(getCreditTopUpProduct("")).toBeUndefined();
    expect(getCreditTopUpProduct("../../etc/passwd")).toBeUndefined();
  });

  it("formats whole-dollar prices without decimals", () => {
    expect(formatCreditTopUpPrice(500)).toBe("S$5");
    expect(formatCreditTopUpPrice(5_000)).toBe("S$50");
    expect(formatCreditTopUpPrice(550)).toBe("S$5.50");
  });
});