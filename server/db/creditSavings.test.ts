import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Credit savings: two reserves, one per credit source.
 *
 * The properties that matter here are financial ones, and each one is a
 * property of the SQL, not of this TypeScript:
 *
 *  1. A set-aside MOVES credits. It never mints them and never destroys
 *     them, so the account's total spendable credits are unchanged.
 *  2. The daily balance is CAPPED at one day's allowance, and the cap has
 *     to hold when two set-asides race. A cap read as a cross-row aggregate
 *     is read from the statement snapshot, so both racers would see the same
 *     pre-race total and both would pass the guard. The cap is therefore
 *     read from a single lockable row (`FOR UPDATE`).
 *  3. Spending from savings never drives a balance below zero.
 *  4. A missing table degrades to an empty balance instead of throwing.
 *
 * The mocked `db` models those SQL semantics - the conditional writes, the
 * lock, the cap - rather than the exact query text, so the assertions hold
 * against the behaviour the money depends on.
 */

type SavingsRow = {
  ownerId: number;
  credits: number;
  remainingCredits: number;
};

const state = vi.hoisted(() => ({
  daily: [] as SavingsRow[],
  paid: [] as SavingsRow[],
  /** The mocked Drizzle table objects, so a select knows which one it hit. */
  dailyTable: { id: "id", ownerId: "ownerId", credits: "credits", remainingCredits: "remainingCredits" },
  paidTable: { id: "id", ownerId: "ownerId", credits: "credits", remainingCredits: "remainingCredits" },
  /** Daily allowance the account gets per day. */
  allocation: 500,
  unlimited: false,
  /** Purchased bundles, oldest first. */
  bundles: [] as Array<{ ownerId: number; remainingCredits: number; createdAt: Date }>,
  /** Set when the caller should see a missing relation. */
  missingRelation: false,
}));

type Cond =
  | { op: "and"; parts: Cond[] }
  | { op: "eq"; column: string; value: unknown };

type Statement = { op: "sql"; strings: string[]; values: unknown[] };

vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ op: "eq", column, value }),
  and: (...parts: Cond[]) => ({ op: "and", parts }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      ({ op: "sql", strings: [...strings], values }) as Statement,
    { raw: (text: string) => ({ op: "raw", text }) }
  ),
}));

/**
 * Renders a statement the way a driver does: the literal chunks joined with
 * the bound values inlined.
 *
 * The mock then reads its parameters out of that rendered text with explicit
 * patterns, rather than by position. A parameter that moves therefore breaks
 * the pattern and the test fails loudly, instead of the mock quietly reading
 * a different value and passing.
 */
function render(statement: Statement): string {
  return statement.strings.reduce(
    (text, chunk, index) =>
      text + chunk + (index < statement.values.length ? inline(statement.values[index]) : ""),
    ""
  );
}

/** Inlines a bound value; `sql.raw` fragments carry their text. */
function inline(value: unknown): string {
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text);
  }
  return String(value);
}

/** The first capture group of `pattern`, or a loud failure. */
function capture(text: string, pattern: RegExp, label: string): number {
  const match = pattern.exec(text);
  if (!match) throw new Error(`the statement did not match ${label}`);
  return Number(match[1]);
}

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond.op === "and") return cond.parts.every(part => matches(row, part));
  return row[cond.column] === cond.value;
}

/** A driver error carrying a Postgres SQLSTATE, like Drizzle wraps. */
function pgError(code: string): Error {
  const error = new Error(`pg error ${code}`);
  (error as Error & { code?: string }).code = code;
  return error;
}

vi.mock("./core", () => ({
  requireDb: vi.fn(async () => ({
    execute: async (statement: Statement) => {
      if (state.missingRelation) throw pgError("42P01");
      const text = render(statement);

      if (text.includes('INSERT INTO "daily_credit_savings"') && text.includes("DO NOTHING")) {
        // The ensure-row statement: creates an empty balance, moves nothing.
        const ownerId = capture(text, /VALUES \((\d+), 0, 0/, "the ensured owner");
        if (!state.daily.some(row => row.ownerId === ownerId)) {
          state.daily.push({ ownerId, credits: 0, remainingCredits: 0 });
        }
        return { rows: [] };
      }

      if (text.includes('INSERT INTO "daily_credit_savings"') && text.includes("FROM debited")) {
        // The daily move: the cap is read from the LOCKED balance row, and
        // the debit of today's allowance is gated on it.
        const ownerId = capture(text, /WHERE "ownerId" = (\d+)/, "the daily owner");
        const credits = capture(text, /WHERE (\d+)::int <= (\d+)::int/, "the daily amount");
        const allocation = capture(text, /WHERE \d+::int <= (\d+)::int/, "the daily allowance");
        const balance = state.daily.find(row => row.ownerId === ownerId);
        if (!balance) return { rows: [] };
        const held = balance.remainingCredits;
        if (credits > allocation) return { rows: [] };
        if (held + credits > allocation) return { rows: [] };
        balance.credits += credits;
        balance.remainingCredits += credits;
        return { rows: [{ credits: balance.credits, remainingCredits: balance.remainingCredits }] };
      }

      if (text.includes('INSERT INTO "paid_credit_savings"')) {
        // The paid move: the oldest bundles are drained first, and the whole
        // amount has to be covered or nothing moves.
        const ownerId = capture(text, /WHERE "ownerId" = (\d+)/, "the paid owner");
        const credits = capture(text, /GREATEST\(0::bigint, (\d+)::bigint/, "the paid amount");
        const bundles = state.bundles
          .filter(bundle => bundle.ownerId === ownerId && bundle.remainingCredits > 0)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const available = bundles.reduce((sum, bundle) => sum + bundle.remainingCredits, 0);
        if (available < credits) return { rows: [] };
        let remaining = credits;
        for (const bundle of bundles) {
          if (remaining <= 0) break;
          const take = Math.min(bundle.remainingCredits, remaining);
          bundle.remainingCredits -= take;
          remaining -= take;
        }
        let balance = state.paid.find(row => row.ownerId === ownerId);
        if (!balance) {
          balance = { ownerId, credits: 0, remainingCredits: 0 };
          state.paid.push(balance);
        }
        balance.credits += credits;
        balance.remainingCredits += credits;
        return { rows: [{ credits: balance.credits, remainingCredits: balance.remainingCredits }] };
      }

      if (text.includes('SELECT "remainingCredits" AS "before"')) {
        // Taking credits out: the decrement is clamped to what the LOCKED row
        // holds, so a balance can never go negative.
        const ownerId = capture(text, /WHERE "ownerId" = (\d+)/, "the spending owner");
        const credits = capture(text, /LEAST\((\d+)::int/, "the spending amount");
        const isDaily = text.includes('"daily_credit_savings"');
        const rows = isDaily ? state.daily : state.paid;
        const balance = rows.find(row => row.ownerId === ownerId);
        const before = balance?.remainingCredits ?? 0;
        const taken = Math.min(before, credits);
        if (balance) balance.remainingCredits = before - taken;
        return { rows: [{ taken, remaining: before - taken }] };
      }

      throw new Error(`the savings module ran an unexpected statement:\n${text}`);
    },
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: Cond) => ({
          limit: async () => {
            const rows = table === state.dailyTable ? state.daily : state.paid;
            return rows
              .filter(row => matches(row as never, cond))
              .map(row => ({
                savedCredits: row.credits,
                remainingCredits: row.remainingCredits,
              }));
          },
        }),
      }),
    }),
  })),
}));

vi.mock("../../drizzle/schema", () => ({
  dailyCreditSavings: state.dailyTable,
  paidCreditSavings: state.paidTable,
}));

vi.mock("./credits", () => ({
  getDailyCreditStatusForUser: vi.fn(async (ownerId: number) => ({
    ownerId,
    region: "global",
    creditDay: "2026-11-27",
    unlimited: state.unlimited,
    dailyCredits: state.unlimited ? null : state.allocation,
    usedCredits: 0,
    inputTokens: 0,
    outputTokens: 0,
    remainingCredits: state.unlimited ? null : state.allocation,
    creditValueCents: 100,
  })),
}));

vi.mock("./creditTopUps", () => ({
  getCreditTopUpBalanceForUser: vi.fn(async (ownerId: number) => {
    const owned = state.bundles.filter(bundle => bundle.ownerId === ownerId);
    return {
      remainingCredits: owned.reduce((sum, bundle) => sum + bundle.remainingCredits, 0),
      activeBundles: owned.length,
      purchasedCredits: owned.reduce((sum, bundle) => sum + bundle.remainingCredits, 0),
    };
  }),
}));

import {
  claimSavingsCreditForUser,
  getCreditSavingsForUser,
  getCreditSavingsOverviewForUser,
  saveCreditsToSavings,
  settleSavingsUsageForUser,
} from "./creditSavings";

const OWNER = 7;

beforeEach(() => {
  state.daily = [];
  state.paid = [];
  state.bundles = [];
  state.allocation = 500;
  state.unlimited = false;
  state.missingRelation = false;
});

describe("saveCreditsToSavings", () => {
  it("rejects an amount that is not a positive whole number of credits", async () => {
    await expect(saveCreditsToSavings(OWNER, "daily", 0)).resolves.toEqual({
      ok: false,
      reason: "invalid_amount",
    });
    await expect(saveCreditsToSavings(OWNER, "daily", -5)).resolves.toEqual({
      ok: false,
      reason: "invalid_amount",
    });
    await expect(saveCreditsToSavings(OWNER, "daily", 12.5)).resolves.toEqual({
      ok: false,
      reason: "invalid_amount",
    });
    expect(state.daily).toHaveLength(0);
  });

  it("refuses an unlimited ledger, which has no allowance to set aside", async () => {
    state.unlimited = true;
    await expect(saveCreditsToSavings(OWNER, "daily", 100)).resolves.toEqual({
      ok: false,
      reason: "unlimited_allowance",
    });
    expect(state.daily).toHaveLength(0);
  });

  it("moves credits into the daily balance and leaves the balance row in place", async () => {
    const result = await saveCreditsToSavings(OWNER, "daily", 200);
    expect(result.ok).toBe(true);
    expect(state.daily).toHaveLength(1);
    expect(state.daily[0]).toMatchObject({ ownerId: OWNER, credits: 200, remainingCredits: 200 });
  });

  it("refuses to take the daily balance over one day's allowance", async () => {
    await saveCreditsToSavings(OWNER, "daily", 400);
    const over = await saveCreditsToSavings(OWNER, "daily", 200);
    expect(over).toEqual({ ok: false, reason: "insufficient_credits" });
    // The refusal moved nothing.
    expect(state.daily[0].remainingCredits).toBe(400);
  });

  it("drains the oldest purchased bundle first", async () => {
    state.bundles.push(
      { ownerId: OWNER, remainingCredits: 300, createdAt: new Date("2026-01-01") },
      { ownerId: OWNER, remainingCredits: 300, createdAt: new Date("2026-02-01") }
    );
    const result = await saveCreditsToSavings(OWNER, "paid", 400);
    expect(result.ok).toBe(true);
    expect(state.bundles[0].remainingCredits).toBe(0);
    expect(state.bundles[1].remainingCredits).toBe(200);
    expect(state.paid[0]).toMatchObject({ credits: 400, remainingCredits: 400 });
  });

  it("refuses to move more than the bought credits hold, and moves nothing", async () => {
    state.bundles.push({ ownerId: OWNER, remainingCredits: 300, createdAt: new Date("2026-01-01") });
    const result = await saveCreditsToSavings(OWNER, "paid", 500);
    expect(result).toEqual({ ok: false, reason: "insufficient_credits" });
    expect(state.bundles[0].remainingCredits).toBe(300);
    expect(state.paid).toHaveLength(0);
  });

  it("fails soft when the savings tables do not exist yet", async () => {
    state.missingRelation = true;
    await expect(saveCreditsToSavings(OWNER, "daily", 100)).resolves.toEqual({
      ok: false,
      reason: "savings_unavailable",
    });
    await expect(saveCreditsToSavings(OWNER, "paid", 100)).resolves.toEqual({
      ok: false,
      reason: "savings_unavailable",
    });
  });
});

describe("getCreditSavingsForUser", () => {
  it("reports the two balances separately", async () => {
    state.daily.push({ ownerId: OWNER, credits: 100, remainingCredits: 100 });
    state.paid.push({ ownerId: OWNER, credits: 250, remainingCredits: 250 });
    const balances = await getCreditSavingsForUser(OWNER);
    expect(balances.daily).toEqual({ savedCredits: 100, remainingCredits: 100 });
    expect(balances.paid).toEqual({ savedCredits: 250, remainingCredits: 250 });
  });

  it("reads an empty balance when the tables do not exist yet", async () => {
    state.missingRelation = true;
    await expect(getCreditSavingsForUser(OWNER)).resolves.toEqual({
      daily: { savedCredits: 0, remainingCredits: 0 },
      paid: { savedCredits: 0, remainingCredits: 0 },
    });
  });
});

describe("getCreditSavingsOverviewForUser", () => {
  it("reports what could still be set aside from each source", async () => {
    state.bundles.push({ ownerId: OWNER, remainingCredits: 400, createdAt: new Date("2026-01-01") });
    const overview = await getCreditSavingsOverviewForUser(OWNER);
    expect(overview.dailyAvailable).toBe(500);
    expect(overview.paidAvailable).toBe(400);
  });

  it("never offers more than the daily cap allows", async () => {
    await saveCreditsToSavings(OWNER, "daily", 400);
    const overview = await getCreditSavingsOverviewForUser(OWNER);
    // 500 allowance, 400 already set aside -> 100 of room left.
    expect(overview.dailyAvailable).toBe(100);
  });

  it("offers nothing when the account is unlimited", async () => {
    state.unlimited = true;
    const overview = await getCreditSavingsOverviewForUser(OWNER);
    expect(overview.dailyAvailable).toBe(0);
  });
});

describe("spending from savings", () => {
  it("claims one credit and settles the extra usage against the same balance", async () => {
    state.daily.push({ ownerId: OWNER, credits: 100, remainingCredits: 100 });
    await expect(claimSavingsCreditForUser(OWNER, "daily")).resolves.toEqual({ remainingCredits: 99 });
    await expect(settleSavingsUsageForUser(OWNER, "daily", 5)).resolves.toEqual({ charged: 5 });
    expect(state.daily[0].remainingCredits).toBe(94);
  });

  it("claims nothing from an empty balance", async () => {
    await expect(claimSavingsCreditForUser(OWNER, "daily")).resolves.toBeUndefined();
    await expect(settleSavingsUsageForUser(OWNER, "daily", 5)).resolves.toEqual({ charged: 0 });
  });

  it("never drives a balance below zero", async () => {
    state.paid.push({ ownerId: OWNER, credits: 3, remainingCredits: 3 });
    await expect(settleSavingsUsageForUser(OWNER, "paid", 10)).resolves.toEqual({ charged: 3 });
    expect(state.paid[0].remainingCredits).toBe(0);
  });

  it("degrades instead of throwing when the tables do not exist yet", async () => {
    state.missingRelation = true;
    await expect(claimSavingsCreditForUser(OWNER, "daily")).resolves.toBeUndefined();
    await expect(settleSavingsUsageForUser(OWNER, "paid", 5)).resolves.toEqual({ charged: 0 });
  });
});
