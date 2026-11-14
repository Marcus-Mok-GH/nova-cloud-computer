import { CREDITS_PER_CURRENCY_UNIT } from "./creditTopUps";

/**
 * Dollar presentation for the credit ledger.
 *
 * The ledger still stores integer credits (1 credit = 1/1,000 of a currency
 * unit, the flat top-up rate in creditTopUps.ts), but every surface shows
 * plain dollars: $1 = 1,000 credits, so Free is $0.50/day, Plus $5.00/day,
 * Pro $10.00/day, and a $5 top-up adds $5.00. Never print raw credit counts
 * in user-facing copy - convert with these helpers instead.
 */

/** Credits (1/1,000 currency units each) -> dollars. */
export function creditsToDollars(credits: number): number {
  return credits / CREDITS_PER_CURRENCY_UNIT;
}

/** Dollars -> integer credits, rounded to the nearest credit (0.001). */
export function dollarsToCredits(dollars: number): number {
  return Math.round(dollars * CREDITS_PER_CURRENCY_UNIT);
}

/** Formats dollars as plain-$ money: formatDollars(0.5) -> "$0.50". */
export function formatDollars(amount: number, locale = "en"): string {
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `$${number}`;
}

/** Formats a raw credit count as dollars: formatCredits(500) -> "$0.50". */
export function formatCredits(credits: number, locale = "en"): string {
  return formatDollars(creditsToDollars(credits), locale);
}
