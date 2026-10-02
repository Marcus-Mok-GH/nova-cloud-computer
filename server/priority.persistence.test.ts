import { beforeEach, describe, expect, it, vi } from "vitest";
import { priorityPurchases } from "../drizzle/schema";

type StoredPurchase = {
  id: number;
  ownerId: number;
  purchasedAt: Date;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

let rows: StoredPurchase[] = [];
let nextId = 1;

/** Recursively pulls drizzle Param values out of a where-condition tree. */
function paramValues(condition: unknown): unknown[] {
  if (!condition || typeof condition !== "object") return [];
  if (Array.isArray((condition as { queryChunks?: unknown[] }).queryChunks)) {
    return ((condition as { queryChunks: unknown[] }).queryChunks).flatMap(paramValues);
  }
  const maybe = condition as { value?: unknown; brand?: unknown; encoder?: unknown };
  if ("brand" in maybe && "encoder" in maybe) return [maybe.value];
  return [];
}

const fakeDb = {
  select: vi.fn((fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (table !== priorityPurchases) return { where: () => ({ limit: async () => [] }) };
      return {
        where: (condition: unknown) => ({
          limit: async () => {
            const [ownerId] = paramValues(condition);
            const found = rows.filter(row => row.ownerId === ownerId);
            // isPriorityUser selects only the activatedAt column.
            if (fields && Object.prototype.hasOwnProperty.call(fields, "activatedAt")) {
              return found.map(row => ({ activatedAt: row.activatedAt }));
            }
            return found;
          },
        }),
      };
    },
  })),
  insert: vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
        if (table !== priorityPurchases) return;
        const existing = rows.find(row => row.ownerId === values.ownerId);
        if (existing) {
          Object.assign(existing, set);
        } else {
          rows.push({
            id: nextId++,
            ownerId: values.ownerId as number,
            purchasedAt: values.purchasedAt as Date,
            activatedAt: (values.activatedAt as Date | null) ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      },
    }),
  })),
  update: vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          if (table !== priorityPurchases) return [];
          const [ownerId] = paramValues(condition);
          // The activation update is guarded by `activatedAt IS NULL`.
          const started = rows.filter(row => row.ownerId === ownerId && row.activatedAt === null);
          started.forEach(row => Object.assign(row, values));
          return started.map(row => ({ id: row.id }));
        },
      }),
    }),
  })),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./modelSecrets", () => ({ encryptModelApiKey: vi.fn(), decryptModelApiKey: vi.fn(), encryptPrivateCredential: vi.fn(), decryptPrivateCredential: vi.fn() }));

const {
  activatePriorityWindowForUser,
  getPriorityStatusForUser,
  isPriorityUser,
  purchasePriorityForUser,
  PRIORITY_DURATION_MS,
} = await import("./db");

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test";
  rows = [];
  nextId = 1;
  vi.clearAllMocks();
});

describe("Priority window", () => {
  it("arms on purchase without starting the clock", async () => {
    const status = await purchasePriorityForUser(7);
    expect(status).toMatchObject({ priority: false, armed: true, activatedAt: null, expiresAt: null });
    expect(await isPriorityUser(7)).toBe(false);
  });

  it("starts the one-hour window on the first message after purchase", async () => {
    await purchasePriorityForUser(7);
    const before = Date.now();
    const result = await activatePriorityWindowForUser(7);
    expect(result.priority).toBe(true);
    expect(result.justActivated).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt!.getTime() - before).toBeGreaterThanOrEqual(PRIORITY_DURATION_MS - 1000);
    expect(await isPriorityUser(7)).toBe(true);
    const status = await getPriorityStatusForUser(7);
    expect(status).toMatchObject({ priority: true, armed: false });
    expect(status.expiresAt).toBeInstanceOf(Date);
  });

  it("does not restart the window on a later message", async () => {
    await purchasePriorityForUser(7);
    const first = await activatePriorityWindowForUser(7);
    const second = await activatePriorityWindowForUser(7);
    expect(second.justActivated).toBe(false);
    expect(second.priority).toBe(true);
    expect(second.expiresAt).toEqual(first.expiresAt);
  });

  it("treats an expired window as not priority and does not restart on a message", async () => {
    await purchasePriorityForUser(7);
    rows[0].activatedAt = new Date(Date.now() - 2 * PRIORITY_DURATION_MS);
    expect(await isPriorityUser(7)).toBe(false);
    const status = await getPriorityStatusForUser(7);
    expect(status).toMatchObject({ priority: false, armed: false });
    const result = await activatePriorityWindowForUser(7);
    expect(result).toMatchObject({ priority: false, justActivated: false });
  });

  it("re-arms an expired purchase so the next message starts a fresh hour", async () => {
    await purchasePriorityForUser(7);
    rows[0].activatedAt = new Date(Date.now() - 2 * PRIORITY_DURATION_MS);
    await purchasePriorityForUser(7);
    expect(rows[0].activatedAt).toBeNull();
    const result = await activatePriorityWindowForUser(7);
    expect(result.justActivated).toBe(true);
    expect(result.priority).toBe(true);
  });

  it("does nothing for an account that never bought priority", async () => {
    const result = await activatePriorityWindowForUser(9);
    expect(result).toMatchObject({ priority: false, justActivated: false, expiresAt: null });
  });
});
