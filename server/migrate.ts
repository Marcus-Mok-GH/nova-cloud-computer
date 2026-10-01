import { existsSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

/**
 * Automatic schema bootstrap.
 *
 * Production (Vercel) applies migrations during the deploy build, so every
 * table exists before a function ever runs. The long-running server (`pnpm
 * start`) has no such build step, so it runs the pending migrations here at
 * boot. Both paths are idempotent: Drizzle records applied migrations in
 * `drizzle.__drizzle_migrations` and skips anything already applied.
 */

/** Candidate locations of the committed Drizzle migration folder across the
 * dev checkout, the standalone server bundle, and a self-hosted deployment. */
function migrationFolderCandidates(): string[] {
  return [
    process.env.NOVA_MIGRATIONS_DIR,
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

let schemaBootstrap: Promise<boolean> | undefined;

/** Runs once per process. Every failure is logged and swallowed: a transient
 * database outage must not stop the server from starting, and the deploy build
 * remains the authoritative migration path. */
export function ensureDatabaseSchema(): Promise<boolean> {
  if (!schemaBootstrap) {
    schemaBootstrap = runMigrations().catch(error => {
      console.error(
        "[Database] Automatic migration failed:",
        error instanceof Error ? error.message : error
      );
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
  await migrate(drizzle(neon(databaseUrl)), { migrationsFolder });
  console.log("[Database] Schema is up to date.");
  return true;
}

/** Clears the once-per-process cache so tests can exercise each branch. */
export function resetSchemaBootstrapForTests(): void {
  schemaBootstrap = undefined;
}
