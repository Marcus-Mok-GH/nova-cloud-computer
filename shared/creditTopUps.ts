/**
 * Credit top-up products.
 *
 * On top of the subscription plans (free daily credits, Nova Pro's monthly
 * pool), an account can buy a one-time bundle of credits. The bundles are
 * deliberately a flat rate - 1,000 credits per S$1 - so the price ladder is
 * predictable and matches what Nova Pro effectively charges per credit.
 *
 * This module is the single source of truth for the ladder: the server builds
 * its Whop checkout from it, the billing UI renders its cards from it, and the
 * webhook refuses to grant anything that is not in it. Prices are integer cents
 * so no floating-point money ever reaches the database or the payment provider.
 *
 * A purchase is laid out as its own row per product (see `credit_purchases`),
 * NOT merged into the monthly ledger: the monthly ledger's balance is derived
 * from an allocation the subscription grants, and mixing bought credits into
 * it would make a lapsed subscription look like it still had credits.
 */

/** Currency for every top-up bundle. Matches the Nova Pro subscription. */
export const CREDIT_TOPUP_CURRENCY = "sgd";

/** Credits granted per whole currency unit (S$1 = 1,000 credits). */
export const CREDITS_PER_CURRENCY_UNIT = 1_000;

export type CreditTopUpProduct = {
  /** Stable slug: the Whop metadata value and the primary key of the ledger row. */
  id: string;
  /** Price in integer cents (SGD). */
  priceCents: number;
  /** Credits granted when a payment for this product succeeds. */
  credits: number;
};

/**
 * The ladder, in ascending price order. Every bundle is priced at the flat
 * CREDITS_PER_CURRENCY_UNIT rate, so the list stays internally consistent.
 */
export const CREDIT_TOPUP_PRODUCTS: readonly CreditTopUpProduct[] = [
  { id: "topup-5", priceCents: 500, credits: 5_000 },
  { id: "topup-10", priceCents: 1_000, credits: 10_000 },
  { id: "topup-20", priceCents: 2_000, credits: 20_000 },
  { id: "topup-30", priceCents: 3_000, credits: 30_000 },
  { id: "topup-40", priceCents: 4_000, credits: 40_000 },
  { id: "topup-50", priceCents: 5_000, credits: 50_000 },
];

/** Looks up a bundle by its slug. */
export function getCreditTopUpProduct(id: string): CreditTopUpProduct | undefined {
  return CREDIT_TOPUP_PRODUCTS.find(product => product.id === id);
}

/**
 * Marks a credit top-up in Whop checkout metadata and on the webhook payload.
 * Kept distinct from the streaming-plan marker so the two products can never be
 * confused when a webhook resolves what was bought.
 */
export const CREDIT_TOPUP_PRODUCT_MARKER = "credits";

/**
 * Formats a bundle price for display, e.g. `S$5`. Whole-dollar bundles drop the
 * decimals; anything with cents keeps exactly two.
 */
export function formatCreditTopUpPrice(priceCents: number): string {
  const symbol = CREDIT_TOPUP_CURRENCY.toUpperCase() === "SGD" ? "S$" : "$";
  const whole = priceCents % 100 === 0;
  return `${symbol}${(priceCents / 100).toFixed(whole ? 0 : 2)}`;
}
