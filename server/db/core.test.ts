import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fakeClient, fakePool, fakeDb, poolConstructor, drizzleMock } = vi.hoisted(() => {
  const fakeClient = {
    query: vi.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
    release: vi.fn(),
  };
  const fakePool = {
    on: vi.fn(),
    connect: vi.fn(async () => fakeClient),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const fakeDb = {};
  const poolConstructor = vi.fn(() => fakePool);
  const drizzleMock = vi.fn(() => fakeDb);
  return { fakeClient, fakePool, fakeDb, poolConstructor, drizzleMock };
});

vi.mock("pg", () => ({ default: { Pool: poolConstructor } }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: drizzleMock }));

import {
  closeDatabase,
  getDatabasePool,
  getDb,
  isTransientDatabaseError,
  pingDatabase,
  resolveSsl,
  withDatabaseReadRetry,
} from "./core";

const envKeys = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NOVA_DB_POOL_MAX",
  "NOVA_DB_IDLE_TIMEOUT_MS",
  "NOVA_DB_CONNECT_TIMEOUT_MS",
  "NOVA_DB_STATEMENT_TIMEOUT_MS",
  "VERCEL",
] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(async () => {
  await closeDatabase();
  vi.clearAllMocks();
  for (const key of envKeys) delete process.env[key];
  fakeClient.query.mockResolvedValue({ rows: [{ value: 1 }] });
  fakePool.connect.mockImplementation(async () => fakeClient);
  fakePool.end.mockResolvedValue(undefined);
});

afterEach(async () => {
  await closeDatabase();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Postgres connection pool", () => {
  it("prefers the managed pooler URL and applies bounded pool defaults", async () => {
    process.env.DATABASE_URL = "postgres://pooler.example/nova";
    process.env.DATABASE_URL_UNPOOLED = "postgres://direct.example/nova";

    await getDb();

    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: process.env.DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 30_000,
        keepAlive: true,
      })
    );
    expect(getDatabasePool()).toBe(fakePool);
    expect(drizzleMock).toHaveBeenCalledWith(fakePool);
  });

  it("uses the direct URL only when no pooled URL is configured", async () => {
    process.env.DATABASE_URL_UNPOOLED = "postgres://direct.example/nova";

    await getDb();

    expect(poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: process.env.DATABASE_URL_UNPOOLED })
    );
  });

  it("does not create a pool when no database URL is configured", async () => {
    await expect(getDb()).resolves.toBeNull();
    expect(poolConstructor).not.toHaveBeenCalled();
  });

  it("probes Postgres and releases its checked-out client", async () => {
    process.env.DATABASE_URL = "postgres://pooler.example/nova";

    await expect(pingDatabase(100)).resolves.toMatchObject({ ok: true });

    expect(fakeClient.query).toHaveBeenCalledWith("select 1");
    expect(fakeClient.release).toHaveBeenCalledOnce();
  });

  it("drains and resets the shared pool", async () => {
    process.env.DATABASE_URL = "postgres://pooler.example/nova";
    await getDb();

    await closeDatabase();

    expect(fakePool.end).toHaveBeenCalledOnce();
    expect(getDatabasePool()).toBeNull();
  });
});

describe("database connection handling", () => {
  it("honours explicit SSL modes and enables TLS for remote hosts", () => {
    expect(resolveSsl("postgres://u:p@localhost/nova?sslmode=disable")).toBe(false);
    expect(resolveSsl("postgres://u:p@db.example/nova?sslmode=verify-full")).toEqual({
      rejectUnauthorized: true,
    });
    expect(resolveSsl("postgres://u:p@db.example/nova")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("recognises transient errors wrapped in a cause", () => {
    const wrapped = new Error("query failed", {
      cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    });

    expect(isTransientDatabaseError(wrapped)).toBe(true);
  });

  it("retries transient read errors but does not retry permanent database errors", async () => {
    const transient = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const operation = vi.fn().mockRejectedValueOnce(transient).mockResolvedValue("ok");

    await expect(withDatabaseReadRetry(operation, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);

    const permanent = Object.assign(new Error("unique violation"), { code: "23505" });
    const rejected = vi.fn().mockRejectedValue(permanent);
    await expect(withDatabaseReadRetry(rejected, { attempts: 3, baseDelayMs: 1 })).rejects.toBe(
      permanent
    );
    expect(rejected).toHaveBeenCalledOnce();
  });
});
