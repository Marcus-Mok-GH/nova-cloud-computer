import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Purchased credit bundles. Two properties matter more than anything else here:
 *
 *  1. A payment must never grant twice. Whop retries a webhook until it gets a
 *     2xx, so the same payment id WILL be delivered more than once.
 *  2. Spending must never take a bundle below zero when two requests race.
 *
 * Both are enforced in SQL (a unique index and a conditional UPDATE), so these
 * mocks model those semantics rather than the exact query text.
 */
const state = vi.hoisted(() => ({
  rows: [] as Array<{
    id: number;
    ownerId: number;
    providerPaymentId: string;
    productId: string;
    priceCents: number;
    currency: string;
    credits: number;
    remainingCredits: number;
    createdAt: Date;
  }>,
  nextId: 1,
}));

const PRODUCT = { id: "topup-10", priceCents: 1_000, credits: 10_000 };

/**
 * Drizzle hands the `where` clause to the driver as an opaque SQL object, so a
 * mock that tries to read `where.ownerId` sees nothing and silently matches
 * every row - which would make an owner-isolation test pass while proving
 * nothing. Mocking the operators into plain descriptors keeps the filter
 * inspectable, so these tests really do assert who can spend what.
 */
type Cond =
  | { op: "and"; parts: Cond[] }
  | { op: "gt"; column: string; value: number }
  | { op: "eq"; column: string; value: unknown };

vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ op: "eq", column, value }),
  and: (...parts: Cond[]) => ({ op: "and", parts }),
  gt: (column: string, value: number) => ({ op: "gt", column, value }),
  desc: (column: string) => ({ op: "desc", column }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ op: "sql", strings: [...strings], values }),
    { raw: (text: string) => ({ op: "raw", text }) }
  ),
}));

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond.op === "and") return cond.parts.every(part => matches(row, part));
  if (cond.op === "gt") return Number(row[cond.column]) > cond.value;
  return row[cond.column] === cond.value;
}

vi.mock("./core", () => ({
  requireDb: vi.fn(async () => ({
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            // unique index on providerPaymentId
            const clash = state.rows.some(r => r.providerPaymentId === row.providerPaymentId);
            if (clash) return [];
            const saved = {
              ...(row as unknown as (typeof state.rows)[number]),
              id: state.nextId++,
              createdAt: new Date(Date.now() + state.nextId),
            };
            state.rows.push(saved);
            return [{ id: saved.id }];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: (cond: Cond) => {
          const filtered = () => state.rows.filter(r => matches(r as never, cond));
          return {
            orderBy: () => ({
              limit: async () =>
                filtered()
                  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                  .map(r => ({ id: r.id })),
            }),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve(
                filtered().map(r => ({ credits: r.credits, remainingCredits: r.remainingCredits }))
              ).then(resolve),
          };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: Cond) => ({
          returning: async () => {
            const row = state.rows.find(r => matches(r as never, cond));
            if (!row) return [];
            if (typeof values.remainingCredits === "object") {
              // a `sql` decrement (`remainingCredits - 1`)
              row.remainingCredits = Math.max(0, row.remainingCredits - 1);
            } else {
              row.remainingCredits = Number(values.remainingCredits);
            }
            return [{ remainingCredits: row.remainingCredits }];
          },
        }),
      }),
    }),
  })),
}));

vi.mock("../../drizzle/schema", () => ({
  creditPurchases: {
    id: "id",
    ownerId: "ownerId",
    providerPaymentId: "providerPaymentId",
    remainingCredits: "remainingCredits",
    createdAt: "createdAt",
  },
}));

import { claimPurchasedCreditForUser, grantCreditTopUp } from "./creditTopUps";

beforeEach(() => {
  state.rows = [];
  state.nextId = 1;
});

describe("grantCreditTopUp", () => {
  it("grants the bundle on first delivery", async () => {
    const result = await grantCreditTopUp({
      ownerId: 1,
      providerPaymentId: "pay_123",
      product: PRODUCT,
      currency: "sgd",
    });
    expect(result.granted).toBe(true);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      providerPaymentId: "pay_123",
      productId: "topup-10",
      credits: 10_000,
      remainingCredits: 10_000,
      currency: "sgd",
    });
  });

  it("does not grant twice when the same payment is delivered again", async () => {
    // Whop retries until it receives a 2xx, so this is the normal path.
    const first = await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_123", product: PRODUCT, currency: "sgd" });
    const second = await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_123", product: PRODUCT, currency: "sgd" });
    const third = await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_123", product: PRODUCT, currency: "sgd" });
    expect(first.granted).toBe(true);
    expect(second.granted).toBe(false);
    expect(third.granted).toBe(false);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].remainingCredits).toBe(10_000);
  });

  it("grants each distinct payment separately", async () => {
    await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_a", product: PRODUCT, currency: "sgd" });
    await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_b", product: PRODUCT, currency: "sgd" });
    expect(state.rows).toHaveLength(2);
    const total = state.rows.reduce((sum, r) => sum + r.remainingCredits, 0);
    expect(total).toBe(20_000);
  });
});

describe("claimPurchasedCreditForUser", () => {
  it("returns undefined when nothing was bought", async () => {
    await expect(claimPurchasedCreditForUser(1)).resolves.toBeUndefined();
  });

  it("spends the oldest bundle first", async () => {
    await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_old", product: { id: "topup-5", priceCents: 500, credits: 2 }, currency: "sgd" });
    await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_new", product: { id: "topup-10", priceCents: 1_000, credits: 10 }, currency: "sgd" });

    const first = await claimPurchasedCreditForUser(1);
    expect(first).toMatchObject({ remainingCredits: 1 });
    expect(state.rows[0].remainingCredits).toBe(1); // the older bundle
    expect(state.rows[1].remainingCredits).toBe(10); // the newer one untouched
  });

  it("moves to the next bundle once one is exhausted", async () => {
    await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_old", product: { id: "topup-5", priceCents: 500, credits: 1 }, currency: "sgd" });
    await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_new", product: { id: "topup-10", priceCents: 1_000, credits: 2 }, currency: "sgd" });

    expect((await claimPurchasedCreditForUser(1))?.remainingCredits).toBe(0);
    expect((await claimPurchasedCreditForUser(1))?.remainingCredits).toBe(1);
    expect(state.rows[0].remainingCredits).toBe(0);
    expect(state.rows[1].remainingCredits).toBe(1);
  });

  it("never drives a bundle below zero", async () => {
    await grantCreditTopUp({ ownerId: 1, providerPaymentId: "pay_a", product: { id: "topup-5", priceCents: 500, credits: 2 }, currency: "sgd" });
    for (let i = 0; i < 10; i += 1) await claimPurchasedCreditForUser(1);
    expect(state.rows[0].remainingCredits).toBe(0);
    expect(state.rows[0].remainingCredits).toBeGreaterThanOrEqual(0);
    expect(await claimPurchasedCreditForUser(1)).toBeUndefined();
  });

  it("only spends the owner's own bundles", async () => {
    await grantCreditTopUp({ ownerId: 2, providerPaymentId: "pay_other", product: PRODUCT, currency: "sgd" });
    await expect(claimPurchasedCreditForUser(1)).resolves.toBeUndefined();
    expect(state.rows[0].remainingCredits).toBe(10_000);
  });
});