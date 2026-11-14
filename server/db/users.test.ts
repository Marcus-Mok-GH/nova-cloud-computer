import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * adoptUserByEmail is the anti-fork guard on the sign-in miss path: a
 * re-issued Neon Auth subject for an address that already owns a row must
 * rebind that row, never insert a second account beside it.
 */
const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: number; openId: string }>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("./core", () => {
  const chain = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => state.rows }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
  };
  return { requireDb: async () => chain };
});

import { adoptUserByEmail } from "./users";

describe("adoptUserByEmail", () => {
  beforeEach(() => {
    state.rows = [];
    state.updates = [];
  });

  it("returns null and writes nothing when no row holds the address", async () => {
    expect(await adoptUserByEmail("someone@example.com", "sub-new")).toBeNull();
    expect(state.updates).toHaveLength(0);
  });

  it("rebinds the stored row to the incoming subject", async () => {
    state.rows = [{ id: 7, openId: "sub-old" }];
    expect(await adoptUserByEmail("someone@example.com", "sub-new")).toBe(7);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ openId: "sub-new" });
  });

  it("leaves a row already on that subject untouched", async () => {
    state.rows = [{ id: 7, openId: "sub-new" }];
    expect(await adoptUserByEmail("someone@example.com", "sub-new")).toBe(7);
    expect(state.updates).toHaveLength(0);
  });
});
