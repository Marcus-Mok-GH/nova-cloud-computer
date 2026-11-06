import { isTransientDatabaseError } from "./core";

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
  primary: PoolLike;
  /** Lazy factory - the backup pool is not created until the first failover. */
  backup: () => PoolLike;
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
    this.primary = options.primary;
    this.backupFactory = options.backup;
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
  activeBackend(): FailoverBackend {
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
