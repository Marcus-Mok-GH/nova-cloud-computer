import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { migrateSpy } = vi.hoisted(() => ({
  migrateSpy: vi.fn(async (_db: unknown, _config: unknown) => {}),
}));

vi.mock("drizzle-orm/neon-http/migrator", () => ({ migrate: migrateSpy }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => ({})) }));
vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));

const { ensureDatabaseSchema, resetSchemaBootstrapForTests, resolveMigrationsFolder } =
  await import("./migrate");

describe("automatic database schema bootstrap", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
  const originalAutoMigrate = process.env.NOVA_AUTO_MIGRATE;

  beforeEach(() => {
    migrateSpy.mockClear();
    resetSchemaBootstrapForTests();
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;
    delete process.env.NOVA_AUTO_MIGRATE;
  });

  afterEach(() => {
    resetSchemaBootstrapForTests();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalUnpooledUrl === undefined) delete process.env.DATABASE_URL_UNPOOLED;
    else process.env.DATABASE_URL_UNPOOLED = originalUnpooledUrl;
    if (originalAutoMigrate === undefined) delete process.env.NOVA_AUTO_MIGRATE;
    else process.env.NOVA_AUTO_MIGRATE = originalAutoMigrate;
  });

  it("finds the committed migration folder from the project root", () => {
    const folder = resolveMigrationsFolder();
    expect(folder).toBeTruthy();
    expect(existsSync(path.join(folder!, "meta", "_journal.json"))).toBe(true);
  });

  it("applies pending migrations when a database URL is configured", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    await expect(ensureDatabaseSchema()).resolves.toBe(true);
    expect(migrateSpy).toHaveBeenCalledTimes(1);
    const config = migrateSpy.mock.calls[0]?.[1] as { migrationsFolder: string };
    expect(config.migrationsFolder).toBe(resolveMigrationsFolder());
  });

  it("skips cleanly when no database URL is configured", async () => {
    await expect(ensureDatabaseSchema()).resolves.toBe(false);
    expect(migrateSpy).not.toHaveBeenCalled();
  });

  it("honors the automatic-migration kill switch", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    process.env.NOVA_AUTO_MIGRATE = "off";
    await expect(ensureDatabaseSchema()).resolves.toBe(false);
    expect(migrateSpy).not.toHaveBeenCalled();
  });

  it("runs at most once per process even when called repeatedly", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    const first = ensureDatabaseSchema();
    const second = ensureDatabaseSchema();
    expect(first).toBe(second);
    await first;
    expect(migrateSpy).toHaveBeenCalledTimes(1);
  });

  it("never rejects when a migration fails", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    migrateSpy.mockRejectedValueOnce(new Error("database unreachable"));
    await expect(ensureDatabaseSchema()).resolves.toBe(false);
  });
});
