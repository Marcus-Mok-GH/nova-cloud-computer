import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgres://test";

/** When true, the insert conflicts (the update id was already claimed). */
let conflict = false;
let executeShouldThrow = false;
const fakeDb = {
  insert: vi.fn(() => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({
        returning: async () => (conflict ? [] : [{ updateId: values.updateId }]),
      }),
    }),
  })),
  execute: vi.fn(async () => { if (executeShouldThrow) throw new Error("table missing"); }),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));

const { claimTelegramUpdate } = await import("./db");

describe("claimTelegramUpdate", () => {
  beforeEach(() => { vi.clearAllMocks(); conflict = false; executeShouldThrow = false; });

  it("claims a first delivery and rejects a redelivered update id", async () => {
    expect(await claimTelegramUpdate(1001)).toBe(true);
    conflict = true; // Telegram redelivers the same update after a timeout
    expect(await claimTelegramUpdate(1001)).toBe(false);
    conflict = false;
    expect(await claimTelegramUpdate(1002)).toBe(true);
  });

  it("prunes rows older than a week on every claim", async () => {
    await claimTelegramUpdate(1002);
    const execute = fakeDb.execute as ReturnType<typeof vi.fn>;
    const flatten = (chunk: unknown): string => typeof chunk === "string" ? chunk : Array.isArray((chunk as { value?: unknown[] })?.value) ? ((chunk as { value: unknown[] }).value.map(flatten).join("")) : chunk && typeof chunk === "object" && "queryChunks" in (chunk as Record<string, unknown>) ? ((chunk as { queryChunks: unknown[] }).queryChunks.map(flatten).join("")) : "";
    const query = (execute.mock.calls.at(-1)!.at(0) as { queryChunks?: unknown[] }).queryChunks?.map(flatten).join("") ?? "";
    expect(query).toContain("telegram_update_log");
    expect(query).toContain("7 days");
  });

  it("fails open when the prune errors, still claiming via the insert", async () => {
    executeShouldThrow = true;
    expect(await claimTelegramUpdate(1003)).toBe(true);
  });
});
