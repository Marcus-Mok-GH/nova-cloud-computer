import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

/**
 * Automatic schema bootstrap.
 *
 * Production (Vercel) applies migrations during the deploy build, so every
 * table normally exists before a function ever runs. The long-running server
 * (`pnpm start`), the local dev server, and the Vercel function itself also run
 * the pending migrations here, so a skipped or failed build-time migration can
 * never leave a first request hitting a missing table. Every path is
 * idempotent: applied migrations are recorded in `drizzle.__drizzle_migrations`
 * exactly as `drizzle-kit migrate` records them, and only pending ones run.
 *
 * The SQL runs through the Neon HTTP driver directly instead of
 * `drizzle-orm/neon-http/migrator`. That migrator maps every result with
 * `rows.map(...)`, but Neon returns `rows: null` for DDL statements such as
 * `CREATE TABLE`, so it throws before creating anything.
 */

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

/** The migration folder sitting beside the CommonJS server bundle. `__dirname`
 * only exists in a CommonJS build (the Vercel function / `dist/server/app.cjs`);
 * the ESM build falls back to the cwd candidates. */
function bundledMigrationsFolder(): string | undefined {
  if (typeof __dirname === "undefined") return undefined;
  return path.join(__dirname, "drizzle");
}

/** Candidate locations of the committed Drizzle migration folder across the
 * dev checkout, the standalone server bundle, and a self-hosted deployment. */
function migrationFolderCandidates(): string[] {
  return [
    process.env.NOVA_MIGRATIONS_DIR,
    bundledMigrationsFolder(),
    path.resolve(process.cwd(), "drizzle/neon"),
    path.resolve(process.cwd(), "dist/server/drizzle"),
    path.resolve(process.cwd(), "dist/drizzle"),
  ].filter((value): value is string => Boolean(value));
}

/** The first candidate that actually holds a Drizzle journal, or null. */
export function resolveMigrationsFolder(): string | null {
  for (const candidate of migrationFolderCandidates()) {
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) return candidate;
  }
  return null;
}

type MigrationFile = { sql: string[]; hash: string; folderMillis: number };

/** Reads the Drizzle journal exactly as `drizzle-kit migrate` does, so the two
 * agree on which migrations exist and in what order. */
function readMigrationFiles(migrationsFolder: string): MigrationFile[] {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ tag: string; when: number }> };
  return journal.entries.map(entry => {
    const query = readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8");
    return {
      sql: query
        .split("--> statement-breakpoint")
        .map(statement => statement.trim())
        .filter(Boolean),
      hash: createHash("sha256").update(query).digest("hex"),
      folderMillis: entry.when,
    };
  });
}

/** The subset of the Neon query function the migrator needs. */
type MigrationQuery = (query: string, params?: unknown[]) => Promise<unknown>;

async function applyMigrations(query: MigrationQuery, migrations: MigrationFile[]): Promise<void> {
  await query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await query(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (` +
      `id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`
  );
  const applied = (await query(
    `SELECT created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ` +
      `ORDER BY created_at DESC LIMIT 1`
  )) as Array<{ created_at: string | number }> | null;
  const lastAppliedMillis = applied?.[0] ? Number(applied[0].created_at) : undefined;
  for (const migration of migrations) {
    if (
      lastAppliedMillis !== undefined &&
      Number.isFinite(lastAppliedMillis) &&
      lastAppliedMillis >= migration.folderMillis
    ) {
      continue;
    }
    for (const statement of migration.sql) await query(statement);
    await query(
      `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ($1, $2)`,
      [migration.hash, migration.folderMillis]
    );
  }
}

let schemaBootstrap: Promise<boolean> | undefined;

/** Runs once per process on success. Every failure is logged and swallowed: a
 * transient database outage must not stop the server from starting, and the
 * deploy build remains the authoritative migration path. A *failed* attempt is
 * deliberately not cached - a warm serverless instance that hit a momentary
 * outage would otherwise keep serving requests against a missing schema until
 * it recycled, so the next request retries instead. Concurrent callers still
 * share one in-flight run. */
export function ensureDatabaseSchema(): Promise<boolean> {
  if (!schemaBootstrap) {
    schemaBootstrap = runMigrations().catch(error => {
      console.error(
        "[Database] Automatic migration failed:",
        error instanceof Error ? error.message : error
      );
      schemaBootstrap = undefined;
      return false;
    });
  }
  return schemaBootstrap;
}

async function runMigrations(): Promise<boolean> {
  if ((process.env.NOVA_AUTO_MIGRATE ?? "").trim().toLowerCase() === "off") {
    console.log("[Database] Automatic migrations disabled (NOVA_AUTO_MIGRATE=off).");
    return false;
  }
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[Database] Skipping automatic migrations: no database URL configured.");
    return false;
  }
  const migrationsFolder = resolveMigrationsFolder();
  if (!migrationsFolder) {
    console.log("[Database] Skipping automatic migrations: no migration files found.");
    return false;
  }
  const migrations = readMigrationFiles(migrationsFolder);
  const sql = neon(databaseUrl);
  await applyMigrations((query, params) => sql.query(query, params) as Promise<unknown>, migrations);
  console.log("[Database] Schema is up to date.");
  return true;
}

/** Clears the once-per-process cache so tests can exercise each branch. */
export function resetSchemaBootstrapForTests(): void {
  schemaBootstrap = undefined;
}
