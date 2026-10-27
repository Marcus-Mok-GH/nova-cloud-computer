import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { querySpy, clientConfigSpy } = vi.hoisted(() => ({
  querySpy: vi.fn(async (_statement: string, _params?: unknown[]) => ({ rows: [] as unknown[] })),
  clientConfigSpy: vi.fn(),
}));

// The migrator builds its own `pg.Client`; intercept that class so every
// statement it issues is observable while `connect`/`end` stay inert.
vi.mock("pg", () => {
  class Client {
    constructor(config: unknown) {
      clientConfigSpy(config);
    }

    query = (statement: string, params?: unknown[]) => querySpy(statement, params);
    connect = async () => undefined;
    end = async () => undefined;
  }
  return { default: { Client }, Client };
});

const { ensureDatabaseSchema, resetSchemaBootstrapForTests, resolveMigrationsFolder } =
  await import("./migrate");

function journalEntryCount(): number {
  const folder = resolveMigrationsFolder();
  if (!folder) return 0;
  return JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")).entries.length;
}

function statements() {
  return querySpy.mock.calls.map(call => String(call[0]));
}

describe("automatic database schema bootstrap", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
  const originalAutoMigrate = process.env.NOVA_AUTO_MIGRATE;

  beforeEach(() => {
    querySpy.mockClear();
    clientConfigSpy.mockClear();
    querySpy.mockResolvedValue({ rows: [] });
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

    const ran = statements();
    expect(ran).toContain('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    expect(ran.some(statement => statement.startsWith('CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations"'))).toBe(true);
    // A real DDL statement from the committed journal runs (the old drizzle
    // session threw on exactly these because Neon returns null rows for DDL).
    expect(ran.some(statement => /CREATE TABLE (IF NOT EXISTS )?"users"/.test(statement))).toBe(true);
    // Each applied migration is recorded once, so later boots skip it.
    expect(ran.filter(statement => statement.startsWith('INSERT INTO "drizzle"."__drizzle_migrations"'))).toHaveLength(journalEntryCount());
    expect(clientConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeoutMillis: 10_000,
        statement_timeout: 30_000,
      })
    );
  });

  it("keeps the newest migration safe to re-run", () => {
    // A migration that was applied out-of-band (or whose bookkeeping was not
    // recorded) must be able to run again: a bare CREATE TABLE / ADD COLUMN
    // stops the deploy build at "already exists" and leaves the rest of the
    // schema uncreated. New migrations are hand-hardened to match the
    // idempotent style of the earlier ones.
    const folder = resolveMigrationsFolder();
    const journal = JSON.parse(readFileSync(path.join(folder!, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const newest = journal.entries[journal.entries.length - 1];
    const sql = readFileSync(path.join(folder!, `${newest.tag}.sql`), "utf8");
    const unguarded = sql
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean)
      .filter(
        statement =>
          /^(CREATE TABLE|CREATE (UNIQUE )?INDEX|CREATE TYPE|ALTER TABLE .* ADD COLUMN|ALTER TABLE .* ADD CONSTRAINT)\b/i.test(statement) &&
          !/IF NOT EXISTS|EXCEPTION WHEN duplicate_object|IF to_regclass/i.test(statement)
      );
    expect(unguarded).toEqual([]);
  });

  it("creates every table declared in the Drizzle schema", () => {
    // The crash this prevents: a table added to drizzle/schema.ts without a
    // committed migration. The runtime bootstrap only replays the migration
    // folder, so a schema-only table is never created and the first query
    // against it fails with `relation ... does not exist` in production. This
    // replays the migration SQL (honoring CREATE / RENAME / DROP) and asserts
    // every declared table ends up live.
    const folder = resolveMigrationsFolder();
    const schema = readFileSync(path.resolve(folder!, "../schema.ts"), "utf8");
    const declared = [...schema.matchAll(/pgTable\(\s*"([a-zA-Z0-9_]+)"/g)].map(match => match[1]);
    expect(declared.length).toBeGreaterThan(0);

    const journal = JSON.parse(readFileSync(path.join(folder!, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const live = new Set<string>();
    for (const entry of journal.entries) {
      const sql = readFileSync(path.join(folder!, `${entry.tag}.sql`), "utf8");
      for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?(?:public\.)?([a-zA-Z0-9_]+)"?/gi))
        live.add(match[1]);
      for (const match of sql.matchAll(/ALTER TABLE "([a-zA-Z0-9_]+)" RENAME TO "([a-zA-Z0-9_]+)"/gi)) {
        live.delete(match[1]);
        live.add(match[2]);
      }
      for (const match of sql.matchAll(/DROP TABLE (?:IF EXISTS )?"?(?:public\.)?([a-zA-Z0-9_]+)"?/gi))
        live.delete(match[1]);
    }

    const uncreated = declared.filter(table => !live.has(table));
    expect(uncreated).toEqual([]);
  });

  it("keeps the journal, its migration files, and the schema in lockstep", () => {
    // A journal entry whose .sql file is missing (or a stray .sql not in the
    // journal) means the bootstrap would silently skip that migration's
    // statements on a fresh database.
    const folder = resolveMigrationsFolder();
    const journal = JSON.parse(readFileSync(path.join(folder!, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const tags = new Set(journal.entries.map(entry => entry.tag));
    const files = readdirSync(folder!).filter(file => file.endsWith(".sql")).map(file => file.replace(/\.sql$/, ""));

    expect(files.filter(file => !tags.has(file))).toEqual([]);
    expect(journal.entries.filter(entry => !files.includes(entry.tag)).map(entry => entry.tag)).toEqual([]);

    // The journal's `when` stamps must ascend, or the runner's
    // last-applied watermark could skip a migration that was never applied.
    const whens = journal.entries.map(entry => Number(entry.when));
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });

  it("skips migrations already recorded by a prior run", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    querySpy.mockImplementation(async (statement: string) => ({
      rows: statement.startsWith("SELECT created_at")
        ? [{ created_at: Number.MAX_SAFE_INTEGER }]
        : [],
    }));
    await expect(ensureDatabaseSchema()).resolves.toBe(true);
    expect(statements().filter(statement => statement.startsWith("INSERT INTO"))).toHaveLength(0);
  });

  it("skips cleanly when no database URL is configured", async () => {
    await expect(ensureDatabaseSchema()).resolves.toBe(false);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("honors the automatic-migration kill switch", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    process.env.NOVA_AUTO_MIGRATE = "off";
    await expect(ensureDatabaseSchema()).resolves.toBe(false);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("runs at most once per process even when called repeatedly", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    const first = ensureDatabaseSchema();
    const second = ensureDatabaseSchema();
    expect(first).toBe(second);
    await first;
    expect(statements().filter(statement => statement.startsWith('CREATE SCHEMA'))).toHaveLength(1);
  });

  it("never rejects when a migration fails", async () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    querySpy.mockRejectedValueOnce(new Error("database unreachable"));
    await expect(ensureDatabaseSchema()).resolves.toBe(false);
  });

  it("retries after a transient failure instead of caching it for the process", async () => {
    // A warm serverless instance must not keep serving against a missing
    // schema because its very first migration attempt hit a momentary outage.
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/nova";
    querySpy.mockRejectedValueOnce(new Error("database unreachable"));
    await expect(ensureDatabaseSchema()).resolves.toBe(false);
    await expect(ensureDatabaseSchema()).resolves.toBe(true);
  });
});
