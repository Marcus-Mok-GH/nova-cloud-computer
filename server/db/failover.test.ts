import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FAILOVER_COOLDOWN_MS,
  FailoverPool,
  failoverCooldownMsFromEnv,
} from "./failover";

function makePool(overrides: Partial<Record<"query" | "connect" | "end", unknown>> = {}) {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
    connect: vi.fn(async () => client),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    client,
    ...overrides,
  };
}

const transientError = () => Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
const integrityError = () => Object.assign(new Error("duplicate key"), { code: "23505" });

describe("FailoverPool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves queries from the primary while it is healthy", async () => {
    const primary = makePool();
    const backup = makePool();
    const pool = new FailoverPool({ primary, backup: () => backup, cooldownMs: 60_000 });

    const result = await pool.query("select 1");

    expect(result).toEqual({ rows: [{ ok: 1 }] });
    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(backup.query).not.toHaveBeenCalled();
    expect(pool.activeBackend()).toBe("primary");
  });

  it("fails over to the backup on a transient error and retries there", async () => {
    const primary = makePool({ query: vi.fn().mockRejectedValue(transientError()) });
    const backup = makePool();
    const pool = new FailoverPool({ primary, backup: () => backup, cooldownMs: 60_000 });

    const result = await pool.query("select 1");

    expect(result).toEqual({ rows: [{ ok: 1 }] });
    expect(backup.query).toHaveBeenCalledTimes(1);
    expect(pool.activeBackend()).toBe("backup");
  });

  it("keeps routing to the backup for the cooldown window", async () => {
    const primary = makePool({ query: vi.fn().mockRejectedValue(transientError()) });
    const backup = makePool();
    const pool = new FailoverPool({ primary, backup: () => backup, cooldownMs: 60_000 });

    await pool.query("select 1");
    await pool.query("select 2");

    expect(primary.query).toHaveBeenCalledTimes(1);
    expect(backup.query).toHaveBeenCalledTimes(2);
  });

  it("returns to the primary once the cooldown expires", async () => {
    const primary = makePool({ query: vi.fn().mockRejectedValueOnce(transientError()) });
    const backup = makePool();
    const pool = new FailoverPool({ primary, backup: () => backup, cooldownMs: 60_000 });

    await pool.query("select 1");
    expect(pool.activeBackend()).toBe("backup");

    vi.advanceTimersByTime(60_001);
    await pool.query("select 1");

    expect(primary.query).toHaveBeenCalledTimes(2);
    expect(pool.activeBackend()).toBe("primary");
  });

  it("does not fail over on non-transient errors", async () => {
    const primary = makePool({ query: vi.fn().mockRejectedValue(integrityError()) });
    const backup = makePool();
    const pool = new FailoverPool({ primary, backup: () => backup, cooldownMs: 60_000 });

    await expect(pool.query("insert ...")).rejects.toMatchObject({ code: "23505" });
    expect(backup.query).not.toHaveBeenCalled();
    expect(pool.activeBackend()).toBe("primary");
  });

  it("connect() fails over the same way as query()", async () => {
    const primary = makePool({ connect: vi.fn().mockRejectedValue(transientError()) });
    const backup = makePool();
    const pool = new FailoverPool({ primary, backup: () => backup, cooldownMs: 60_000 });

    const client = await pool.connect();

    expect(backup.connect).toHaveBeenCalledTimes(1);
    expect(client.release).toBeTypeOf("function");
    expect(pool.activeBackend()).toBe("backup");
  });

  it("creates the backup pool lazily, only on first failover", async () => {
    const primary = makePool();
    const backupFactory = vi.fn(() => makePool());
    const pool = new FailoverPool({ primary, backup: backupFactory, cooldownMs: 60_000 });

    await pool.query("select 1");
    expect(backupFactory).not.toHaveBeenCalled();
  });

  it("end() drains both pools", async () => {
    const primary = makePool({ query: vi.fn().mockRejectedValue(transientError()) });
    const backup = makePool();
    const pool = new FailoverPool({ primary, backup: () => backup, cooldownMs: 60_000 });

    await pool.query("select 1");
    await pool.end();

    expect(primary.end).toHaveBeenCalledTimes(1);
    expect(backup.end).toHaveBeenCalledTimes(1);
  });
});

describe("failoverCooldownMsFromEnv", () => {
  afterEach(() => {
    delete process.env.NOVA_DB_FAILOVER_COOLDOWN_MS;
  });

  it("uses the default when unset or invalid", () => {
    expect(failoverCooldownMsFromEnv()).toBe(DEFAULT_FAILOVER_COOLDOWN_MS);
    process.env.NOVA_DB_FAILOVER_COOLDOWN_MS = "not-a-number";
    expect(failoverCooldownMsFromEnv()).toBe(DEFAULT_FAILOVER_COOLDOWN_MS);
    process.env.NOVA_DB_FAILOVER_COOLDOWN_MS = "-5";
    expect(failoverCooldownMsFromEnv()).toBe(DEFAULT_FAILOVER_COOLDOWN_MS);
  });

  it("honours a positive override", () => {
    process.env.NOVA_DB_FAILOVER_COOLDOWN_MS = "5000";
    expect(failoverCooldownMsFromEnv()).toBe(5000);
  });
});
