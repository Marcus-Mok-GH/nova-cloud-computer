import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * Deploy-build migration gate.
 *
 * `vercel.json` runs this before `pnpm run build` instead of the strict
 * `db:migrate:deploy` script. Applying migrations remains the deploy build's
 * job, but a database outage must not take every deployment down with it:
 * while Neon refuses connections (plan quota exhausted, suspended compute,
 * transient network), the old first step aborted the whole build before any
 * code was compiled, and drizzle-kit's spinner hid the real error from the
 * log.
 *
 * The gate probes the database first, over the same `pg` driver and
 * connection string `drizzle-kit migrate` would use. When the probe answers,
 * migrations run exactly as before, so genuine SQL failures still fail the
 * build. When it does not, the gate prints the underlying error as a build
 * warning and lets the deploy continue: the runtime bootstrap
 * (server/migrate.ts) already retries pending migrations on the first
 * database-backed request, so the schema catches up on the next healthy
 * deploy or first request instead of blocking every deploy. Manual
 * `pnpm run db:migrate:deploy` stays strict.
 */

export const PROBE_TIMEOUT_MS = 15_000;

export type DatabaseProbe = { ok: true } | { ok: false; reason: string };

export type MigrateResult = { status: number | null; error?: Error };

/** Same URL resolution as drizzle.config.ts: the direct endpoint when the
 * pooled one is available, since drizzle-kit holds a dedicated connection. */
export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL ?? null;
}

/** Cheap reachability check over the same wire drizzle-kit would use. */
export async function probeDatabase(
  databaseUrl: string,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<DatabaseProbe> {
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    await client.query("select 1");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function runDrizzleKitMigrate(): MigrateResult {
  return spawnSync("pnpm", ["run", "db:migrate"], { stdio: "inherit" });
}

export interface DeployMigrationOptions {
  env?: NodeJS.ProcessEnv;
  probe?: (databaseUrl: string) => Promise<DatabaseProbe>;
  migrate?: () => MigrateResult;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

/** Runs the deploy's migration step and returns the build's exit code. */
export async function runDeployMigrations(
  options: DeployMigrationOptions = {}
): Promise<number> {
  const {
    env = process.env,
    probe = probeDatabase,
    migrate = runDrizzleKitMigrate,
    log = console.log,
    warn = console.warn,
  } = options;
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    log("Skipping migrations (no database URL in this environment)");
    return 0;
  }
  const probeResult = await probe(databaseUrl);
  if (!probeResult.ok) {
    warn(`[migrate-deploy] Database unreachable: ${probeResult.reason}`);
    warn(
      "[migrate-deploy] Skipping build-time migrations so this deploy can still ship."
    );
    warn(
      "[migrate-deploy] The runtime bootstrap retries pending migrations on the first database-backed request."
    );
    return 0;
  }
  const result = migrate();
  if (result.error) {
    warn(
      `[migrate-deploy] Could not run pnpm run db:migrate: ${result.error.message}`
    );
  }
  return result.status ?? 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void runDeployMigrations().then(
    exitCode => process.exit(exitCode),
    error => {
      console.error(
        "[migrate-deploy] Unexpected failure:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  );
}
