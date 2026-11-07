import type pg from "pg";

/**
 * Postgres SQLSTATEs and Node socket errors worth failing over: the
 * connection or its backend went away, the server is starting up /
 * shutting down, or the pooler refused a slot. Anything else (constraint
 * violation, syntax error, permission denied) is a real answer from
 * Postgres and never triggers a failover.
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

/**
 * Neon (and its proxy) refuse connections with a plan-quota message instead of
 * a proper SQLSTATE once the monthly compute-time or data-transfer allowance
 * is exhausted: "Your project has exceeded the data transfer quota. Upgrade
 * your plan to increase limits." The compute is left suspended, so nothing on
 * the primary can answer until the allowance resets - exactly when a hot
 * backup should take over. Match the message, because the error carries no
 * useful `code`: the proxy rejects before the Postgres handshake, so `pg`
 * reports a connection failure without a server-produced SQLSTATE.
 */
const PLAN_QUOTA_EXHAUSTED_PATTERN =
  /has exceeded the [a-z ]{0,32}quota\.?\s*Upgrade your plan/i;

/** True when the error (or anything in its cause chain) is worth failing over. */
export function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!(current instanceof Error)) return false;
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_DATABASE_CODES.has(code)) {
      return true;
    }
    if (PLAN_QUOTA_EXHAUSTED_PATTERN.test(current.message)) return true;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Pool-level failover between a primary database (Neon) and a hot backup.
 *
 * Why this exists: Neon's free plan suspends the compute when the 5 GB/month
 * data-transfer allowance is exhausted, which drops every connection at once
 * until the next billing cycle. With `BACKUP_DATABASE_URL` configured, the
 * app keeps serving reads AND writes from a second database (replicated via
 * logical replication - see `docs/database-failover.md`) instead of going
 * dark for the rest of the month.
 *
 * Routing policy:
 *  - everything goes to the primary while it is healthy;
 *  - the first transient connection error marks the primary down for
 *    `cooldownMs` and the failed query is retried once on the backup;
 *  - after the cooldown the next operation tries the primary again, so a
 *    recovered primary resumes traffic without any manual switch;
 *  - non-transient errors (constraint violations, bad SQL) are real answers
 *    from Postgres - they never trigger a failover, on either side;
 *  - with no backup configured the facade wraps only the primary and behaves
 *    exactly like the raw pool.
 *
 * Transactions: `connect()` pins one backend for the whole session, so a
 * transaction runs entirely on whichever side was healthy when it started. A
 * transaction that loses its backend midway fails and must be retried by the
 * caller - the commit outcome is unknowable, so the facade never replays it.
 */

export type FailoverBackend = "primary" | "backup";

/** The sliver of a pooled client the app uses (`query` + `release`). */
type PoolClientLike = {
  query: (...args: unknown[]) => Promise<unknown>;
  release: (destroy?: boolean) => void;
};

/** The sliver of `pg.Pool` the app and Drizzle use (`query`/`connect`/`end`/`on`). */
type PoolLike = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
  connect: () => Promise<PoolClientLike>;
  end: () => Promise<void>;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

export type FailoverPoolOptions = {
  primary: pg.Pool | PoolLike;
  /** Lazy factory - the backup pool is not created until the first failover. */
  backup: () => pg.Pool | PoolLike;
  /** How long the primary stays marked down after a transient failure. */
  cooldownMs: number;
};

export const DEFAULT_FAILOVER_COOLDOWN_MS = 60_000;

export class FailoverPool {
  private readonly primary: PoolLike;
  private readonly backupFactory: () => PoolLike;
  private readonly cooldownMs: number;
  private backupPool: PoolLike | null = null;
  private primaryDownUntil = 0;

  constructor(options: FailoverPoolOptions) {
    // pg.Pool's overloaded `on` never satisfies a structural function-property
    // type, so the boundary casts through unknown; the facade only calls the
    // sliver of the API declared in PoolLike.
    this.primary = options.primary as unknown as PoolLike;
    this.backupFactory = () => options.backup() as unknown as PoolLike;
    this.cooldownMs = Math.max(1, options.cooldownMs);
  }

  get hasBackup(): boolean {
    return true;
  }

  private get backup(): PoolLike {
    if (!this.backupPool) this.backupPool = this.backupFactory();
    return this.backupPool;
  }

  private primaryIsDown(): boolean {
    return Date.now() < this.primaryDownUntil;
  }

  private markPrimaryDown(error: unknown) {
    this.primaryDownUntil = Date.now() + this.cooldownMs;
    console.warn(
      `[Database] Primary unreachable, failing over to the backup for ~${Math.round(
        this.cooldownMs / 1000
      )}s:`,
      error instanceof Error ? error.message : error
    );
  }

  /** Which backend a query would use right now - reported by /api/health. */
  get activeBackend(): FailoverBackend {
    return this.primaryIsDown() ? "backup" : "primary";
  }

  async query(text: string, params?: unknown[]): Promise<unknown> {
    if (this.primaryIsDown()) {
      return this.backup.query(text, params);
    }
    try {
      return await this.primary.query(text, params);
    } catch (error) {
      if (!isTransientDatabaseError(error)) throw error;
      this.markPrimaryDown(error);
      return this.backup.query(text, params);
    }
  }

  async connect(): Promise<PoolClientLike> {
    if (this.primaryIsDown()) {
      return this.backup.connect();
    }
    try {
      return await this.primary.connect();
    } catch (error) {
      if (!isTransientDatabaseError(error)) throw error;
      this.markPrimaryDown(error);
      return this.backup.connect();
    }
  }

  async end(): Promise<void> {
    await Promise.all([this.primary.end(), this.backupPool?.end()]);
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.primary.on(event, listener);
    this.backupPool?.on(event, listener);
    return this;
  }
}

/** Reads `NOVA_DB_FAILOVER_COOLDOWN_MS`, falling back to the default. */
export function failoverCooldownMsFromEnv(): number {
  const raw = process.env.NOVA_DB_FAILOVER_COOLDOWN_MS;
  if (!raw) return DEFAULT_FAILOVER_COOLDOWN_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FAILOVER_COOLDOWN_MS;
}
