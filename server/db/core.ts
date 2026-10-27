import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * The workspace database connection layer.
 *
 * Every query runs through one shared `pg.Pool` instead of a stateless HTTP
 * driver. Connections are reused across requests, a transaction pins one
 * backend for its whole lifetime, and a connection that dies is replaced by
 * the pool instead of failing the request that happened to be in flight.
 *
 * Two details matter for reliability and are easy to get wrong:
 *  - an idle client that emits `error` (server restart, network blip, pooler
 *    eviction) crashes Node unless a listener is attached. The pool-level
 *    handler below swallows and logs it so the process survives.
 *  - application traffic prefers `DATABASE_URL`, which is the managed pooler
 *    URL in this deployment. The migration runner separately prefers
 *    `DATABASE_URL_UNPOOLED` because DDL needs a direct session.
 */

export type Database = NodePgDatabase<Record<string, never>>;

const DEFAULT_POOL_MAX = 5;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/**
 * Postgres SQLSTATEs and Node socket errors worth retrying: the connection or
 * its backend went away, the server is starting up / shutting down, or the
 * pooler refused a slot. Anything else (constraint violation, syntax error,
 * permission denied) is a real answer and must not be retried.
 */
const TRANSIENT_DATABASE_CODES = new Set([
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "08007", // transaction_resolution_unknown
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
]);

let _db: Database | null = null;
let _pool: pg.Pool | null = null;

/**
 * Neon (and most managed Postgres) require TLS for remote hosts but accept
 * plaintext on loopback. Honour an explicit `sslmode` first, then fall back to
 * "TLS unless the host is local" so a connection string without `sslmode`
 * still connects securely instead of failing the handshake.
 */
export function resolveSsl(connectionString: string): pg.PoolConfig["ssl"] {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { rejectUnauthorized: false };
  }
  const mode = url.searchParams.get("sslmode");
  if (mode === "disable") return false;
  if (mode) return { rejectUnauthorized: mode === "verify-ca" || mode === "verify-full" };
  const host = url.hostname;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal");
  return isLocal ? false : { rejectUnauthorized: false };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildPoolConfig(connectionString: string): pg.PoolConfig {
  return {
    connectionString,
    ssl: resolveSsl(connectionString),
    max: readPositiveInt(process.env.NOVA_DB_POOL_MAX, DEFAULT_POOL_MAX),
    idleTimeoutMillis: readPositiveInt(
      process.env.NOVA_DB_IDLE_TIMEOUT_MS,
      DEFAULT_IDLE_TIMEOUT_MS
    ),
    connectionTimeoutMillis: readPositiveInt(
      process.env.NOVA_DB_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS
    ),
    // Bounds a runaway query instead of letting it hold a pooled connection
    // until the request times out somewhere further up the stack.
    statement_timeout: readPositiveInt(
      process.env.NOVA_DB_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS
    ),
    keepAlive: true,
    application_name: "nova-cloud-computer",
    // Serverless instances should not pin the event loop open once work drains.
    allowExitOnIdle: Boolean(process.env.VERCEL),
  };
}

function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool(buildPoolConfig(connectionString));
  pool.on("error", error => {
    // Idle-client failures are expected in any long-lived pool. Log and move
    // on; the pool discards the broken client and dials a fresh one.
    console.warn(
      "[Database] Pooled connection error:",
      error instanceof Error ? error.message : error
    );
  });
  return pool;
}

/**
 * Returns the shared Drizzle client, creating the pool on first use. Returns
 * `null` when no database is configured so callers can degrade instead of
 * throwing at import time (tests and preview environments run without one).
 */
export async function getDb(): Promise<Database | null> {
  if (!_db) {
    const connectionString =
      process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim();
    if (!connectionString) return null;
    try {
      _pool = createPool(connectionString);
      _db = drizzle(_pool);
    } catch (error) {
      console.warn(
        "[Database] Failed to initialise the connection pool:",
        error instanceof Error ? error.message : error
      );
      _pool = null;
      _db = null;
    }
  }
  return _db;
}

export async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db)
    throw new Error(
      "Nova can't reach your workspace data right now. Please try again shortly."
    );
  return db;
}

/** The live pool, or `null` before first use. Exposed for health checks and graceful shutdown. */
export function getDatabasePool(): pg.Pool | null {
  return _pool;
}

/** True when the error (or anything in its cause chain) is worth retrying. */
export function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_DATABASE_CODES.has(code)) {
      return true;
    }
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Retries an idempotent, read-only operation on transient connection errors
 * with exponential backoff and jitter. Do not use this for writes: a lost
 * connection can leave a write's commit outcome unknown.
 */
export async function withDatabaseReadRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 100);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransientDatabaseError(error)) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * delay * 0.25;
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }
  throw lastError;
}

export type DatabaseHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

/**
 * Cheap liveness probe: checks out one connection and asks the server for its
 * clock. The timeout destroys a stalled checked-out connection so a probe
 * cannot leave it occupying a pool slot after the health request returns.
 */
export async function pingDatabase(
  timeoutMs: number = DEFAULT_CONNECTION_TIMEOUT_MS
): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  const pool = _pool ?? (await getDb(), _pool);
  if (!pool) {
    return { ok: false, latencyMs: 0, error: "No database configured" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let client: pg.PoolClient | undefined;
  let timedOut = false;
  const timeoutError = new Error(`Database probe timed out after ${timeoutMs}ms`);
  try {
    const connection = pool.connect().then(async checkedOut => {
      if (timedOut) {
        checkedOut.release(true);
        throw timeoutError;
      }
      client = checkedOut;
      await checkedOut.query("select 1");
    });
    await Promise.race([
      connection,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          client?.release(true);
          client = undefined;
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (client && !timedOut) client.release();
  }
}

/**
 * Drains the pool. Called on shutdown so in-flight queries finish and no
 * sockets are left half-open; safe to call when the pool was never created.
 */
export async function closeDatabase(): Promise<void> {
  const pool = _pool;
  _pool = null;
  _db = null;
  if (!pool) return;
  await pool.end().catch(error => {
    console.warn(
      "[Database] Error while closing the pool:",
      error instanceof Error ? error.message : error
    );
  });
}

/**
 * The workspace enforces one file per (folder, name) via a unique constraint.
 * Drizzle wraps the database error, so walk the cause chain for Postgres
 * code 23505. A duplicate insert means the name is taken; callers surface a
 * friendly "already exists" result instead of a raw database error.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = (current as Error & { code?: unknown }).code;
    if (code === "23505") return true;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

/** Current database server time - used so stop requests and run starts are compared on one clock. */
export async function getDatabaseTime(): Promise<Date> {
  const db = await requireDb();
  const result = (await withDatabaseReadRetry(() =>
    db.execute(sql`select now() as now`)
  )) as unknown as
    | { rows?: Array<{ now: string | Date }> }
    | Array<{ now: string | Date }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const value = rows[0]?.now;
  if (!value) return new Date();
  return value instanceof Date ? value : new Date(value);
}
