import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_BOT_SYSTEM_PROMPT } from "../supportBot";
import {
  OUTAGE_COMPENSATION_CREDITS,
  OUTAGE_COMPENSATION_CUTOFF_ISO,
  OUTAGE_COMPENSATION_PAYMENT_PREFIX,
  OUTAGE_COMPENSATION_PRODUCT_ID,
  outageCompensationPaymentId,
} from "../../shared/outageCompensation";

/**
 * The goodwill credits granted for the storage-outage inconvenience.
 *
 * Two things have to hold, and neither is visible from the app:
 *
 *  1. The grant must be a FIXED set of accounts. Without a cutoff the same
 *     outage would compensate a different set of accounts depending on when
 *     the migration happened to run, and re-running it would reach accounts
 *     created after the disruption - which never experienced it.
 *  2. The migration and the shared module must agree. The migration is
 *     hand-written SQL and cannot import the shared constants, so the two
 *     copies can drift; these assertions are what catch it.
 */

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "drizzle/neon/0071_outage_credit_compensation.sql"
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("the outage compensation grant", () => {
  it("grants the amount the shared module promises", () => {
    const sql = migrationSql();
    // The grant is written as a literal in both places; assert the migration
    // carries the same number.
    expect(sql).toContain(String(OUTAGE_COMPENSATION_CREDITS));
    expect(OUTAGE_COMPENSATION_CREDITS).toBe(1_000);
  });

  it("marks the rows with the shared ledger marker and payment prefix", () => {
    const sql = migrationSql();
    expect(sql).toContain(`'${OUTAGE_COMPENSATION_PRODUCT_ID}'`);
    expect(sql).toContain(`'${OUTAGE_COMPENSATION_PAYMENT_PREFIX}'`);
  });

  it("uses the shared cutoff, so the compensated set is fixed", () => {
    const sql = migrationSql();
    expect(sql).toContain(`'${OUTAGE_COMPENSATION_CUTOFF_ISO}'`);
    // And the cutoff is a real instant, not a typo that would exclude
    // everyone.
    expect(Number.isFinite(Date.parse(OUTAGE_COMPENSATION_CUTOFF_ISO))).toBe(true);
  });

  it("is re-appliable: one row per account, guarded by the unique index", () => {
    const sql = migrationSql();
    expect(sql).toContain('ON CONFLICT ("providerPaymentId") DO NOTHING');
  });

  it("promises the same number in the copy that tells the user", () => {
    // The amount appears in three places: the migration, the waitlist note
    // (which derives it from the shared constant) and the FAQ answer (which
    // is prose). A drift here would tell an account it received credits it
    // never got, so the copy is asserted against the constant.
    const source = readFileSync(
      path.resolve(process.cwd(), "client/src/i18n/en.ts"),
      "utf8"
    );
    const faq = source.match(/"landing\.faq\.a7":\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    expect(faq).toContain(`${OUTAGE_COMPENSATION_CREDITS.toLocaleString("en-US")} credits`);
  });

  it("tells the support bot the same number, so it cannot invent one", () => {
    // The bot answers questions about the outage. If its brief drifted from
    // the grant, it would tell a user a number that is not on their balance.
    // The brief is a template literal, so assert on the RENDERED prompt.
    const rendered = SUPPORT_BOT_SYSTEM_PROMPT;
    expect(rendered).toContain(
      `${OUTAGE_COMPENSATION_CREDITS.toLocaleString("en-US")} credits`
    );
  });

  it("gives each account its own payment id", () => {
    expect(outageCompensationPaymentId(7)).not.toBe(outageCompensationPaymentId(8));
    expect(outageCompensationPaymentId(7)).toBe(
      `${OUTAGE_COMPENSATION_PAYMENT_PREFIX}7`
    );
  });
});
