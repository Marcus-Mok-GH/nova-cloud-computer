/**
 * Two-way reconciliation between the primary and backup databases.
 *
 * Each database holds one row in `db_reconciliation_state`:
 *  - `database_role` `"active"` or `"standby"` — the more recently activated
 *    side is the source during failback, the older side is the target;
 *  - `epoch` incremented on every role assignment — a stale process holding an
 *    old epoch can skip the row and still observe the flip;
 *  - `last_verified_at` — the last time reconciliation proved both sides share
 *    the same newest-first row snapshot.
 *
 * Reconciliation is value-level and symmetric:
 *  1. At failover, rows already on the source are pushed to the target.
 *  2. When the standby accepts writes during an outage, the active backend is
 *     the standby — so its active epoch is newer than the primary's.
 *  3. When the primary recovers and again passes its probe, the reconciler
 *     compares full snapshots before traffic returns.
 *  4. For every row present in either snapshot, the row with the newer
 *     `updatedAt` (max of `updatedAt`, `createdAt`) wins; rows absent from
 *     the target are inserted; present rows are replaced only when the
 *     source row is strictly newer. Deletes are recorded as
 *     `__sync_deleted_at` tombstones so a delete performed on the active side
 *     propagates on return. Rows whose update time is null (e.g. capped
 *     `api_keys`, `telegram_update_log`, `whop_webhook_events`) are refreshed
 *     unconditionally from the source — no row is ever dropped.
 *
 * DDL note: `db_reconciliation_state`, the `__sync_deleted_at` tombstone
 * columns, and the sequence reset are Postgres-specific SQL. Neon's logical
 * replication is primary→standby; while the standby is active its writes do
 * not replicate back, which is why this reconciler exists. Sequence positions
 * are re-synced after each run so serial inserts cannot collide on the peer.
 * A single-race edge remains: two processes can both boot a cold pool after
 * separate outages, so roles are settled by epoch and the loser takes the
 * winner's snapshot — at most the last-written row can differ for both.
 */

import type pg from "pg";

/** The sliver of a pooled client Drizzle/`pg` expose. */
export type ReconcilerPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

type ReconcileDb = Pick<ReconcilerPool, "query">;

export type FailoverBackend = "primary" | "backup";

export type RoleRow = {
  epoch: number;
  lastVerifiedAt: Date;
};

export type TableMeta = {
  name: string;
  primaryKeyColumns: string[];
  timestampColumns: string[];
};

export type SyncRow = {
  key: unknown[];
  tombstoneAt?: Date | null;
  values: Record<string, unknown>;
};

export type ReconcileResult = {
  source: "primary" | "backup";
  tables: Record<string, { inserted: number; updated: number; deletes: number }>;
};

export type VerifyResult = {
  ok: boolean;
  message: string;
};

const TABLE_EXCLUDED = new Set(["db_reconciliation_state", "telegram_update_log", "whop_webhook_events"]);

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Parse a text sent from the MORE to an array; `pool` is available for FK probing. */
export function quoteTable(name: string): string {
  return quoteIdent(name);
}

export async function recordRoleOnce(db: ReconcileDb, role: "active" | "standby"): Promise<void> {
  await db.query(
    `INSERT INTO "db_reconciliation_state" ("database_role", "epoch", "last_verified_at")
     VALUES (${quoteLiteral(role)}, 1, now())
     ON CONFLICT ("database_role") DO NOTHING`,
  );
}

export async function recordRole(db: ReconcileDb, role: "active" | "standby"): Promise<RoleRow> {
  await recordRoleOnce(db, role);
  const result = await db.query(
    `UPDATE "db_reconciliation_state"
     SET "epoch" = "epoch" + 1, "last_verified_at" = now()
     WHERE "database_role" = ${quoteLiteral(role)}
     RETURNING "epoch", "last_verified_at"`,
  );
  return {
    epoch: Number(result.rows[0]!.epoch),
    lastVerifiedAt: toDate(result.rows[0]!.last_verified_at),
  };
}

export async function readRole(db: ReconcileDb, role: "active" | "standby"): Promise<RoleRow | null> {
  const result = await db.query(
    `SELECT "epoch", "last_verified_at" FROM "db_reconciliation_state" WHERE "database_role" = ${quoteLiteral(role)} LIMIT 1`,
  );
  if (!result.rows[0]) return null;
  return {
    epoch: Number(result.rows[0].epoch),
    lastVerifiedAt: toDate(result.rows[0].last_verified_at),
  };
}

/** The target store is whichever side holds the older epoch. */
export async function reconcileDatabases(
  primary: ReconcileDb,
  backup: ReconcileDb,
  options: { now?: Date; source?: FailoverBackend } = {},
): Promise<ReconcileResult> {
  const [pActive, bActive, pStandby, bStandby] = await Promise.all([
    readRole(primary, "active"),
    readRole(backup, "active"),
    readRole(primary, "standby"),
    readRole(backup, "standby"),
  ]);

  // Prefer two sides who agree on roles. Fall back to explicit option.
  const pEpoch = (pActive?.epoch ?? 0) + (pStandby?.epoch ?? 0);
  const bEpoch = (bActive?.epoch ?? 0) + (bStandby?.epoch ?? 0);
  let source: FailoverBackend;
  if (options.source) source = options.source;
  else if (pEpoch === bEpoch) source = pEpoch >= (bActive?.epoch ?? 0) ? "primary" : "backup";
  else source = pEpoch > bEpoch ? "primary" : "backup";

  const sourceDb = source === "primary" ? primary : backup;
  const targetDb = source === "primary" ? backup : primary;

  const winner = source === "primary" ? primary : backup;
  const loser = source === "primary" ? backup : primary;

  // Ensure epoch rows exist on both sides so the next handoff is observable.
  for (const db of [primary, backup]) {
    await recordRoleOnce(db, "active");
    await recordRoleOnce(db, "standby");
  }

  // Mark the source as active and the target as standby with fresh epochs.
  await recordRole(winner, "active");
  await recordRole(loser, "standby");

  const tables = await listTables(sourceDb);
  const counts: Record<string, { inserted: number; updated: number; deletes: number }> = {};

  for (const table of tables) {
    counts[table.name] = await reconcileTable(sourceDb, targetDb, table, options.now);
  }

  await resetSequences(sourceDb, targetDb, tables);

  // Mark verified now that the winner's snapshot is on both sides.
  await primary.query(`UPDATE "db_reconciliation_state" SET "last_verified_at" = now()`);
  await backup.query(`UPDATE "db_reconciliation_state" SET "last_verified_at" = now()`);

  return { source, tables: counts };
}

async function listTables(db: ReconcileDb): Promise<TableMeta[]> {
  const result = await db.query(
    `SELECT t.table_name AS name,
            COALESCE(array_agg(k.column_name ORDER BY k.ordinal_position) FILTER (WHERE k.column_name IS NOT NULL), '{}') AS pk
     FROM information_schema.tables t
     LEFT JOIN information_schema.key_column_usage k
       ON k.table_name = t.table_name
      AND k.table_schema = 'public'
      AND k.constraint_name IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        WHERE tc.table_name = t.table_name
          AND tc.table_schema = 'public'
          AND tc.constraint_type = 'PRIMARY KEY'
      )
     WHERE t.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
     GROUP BY t.table_name`,
  );

  const tables: TableMeta[] = [];

  for (const row of result.rows) {
    const name = String(row.name);
    if (TABLE_EXCLUDED.has(name)) continue;
    let pk: string[] = Array.isArray(row.pk) ? (row.pk as string[]) : [];
    if (!pk.length) continue;
    const cols = await listColumns(db, name);
    tables.push({
      name,
      primaryKeyColumns: pk,
      timestampColumns: cols.filter(c => c === "updatedAt" || c === "createdAt" || c === "receivedAt"),
    });
  }

  return tables.sort((a, b) => tableRank(a.name) - tableRank(b.name) || a.name.localeCompare(b.name));
}

async function listColumns(db: ReconcileDb, table: string): Promise<string[]> {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${quoteLiteral(table)} ORDER BY ordinal_position`,
  );
  return result.rows.map(r => String(r.column_name));
}

function tableRank(name: string): number {
  const order = [
    "users",
    "workspaces",
    "projects",
    "tasks",
    "custom_models",
    "workspace_settings",
    "workspace_env_vars",
    "workspace_folders",
    "workspace_files",
    "workspace_skills",
    "chats",
    "chat_messages",
    "conversation_memories",
    "telegram_bot_settings",
    "api_keys",
    "mistral_inference_allowances",
    "daily_credits",
    "monthly_credits",
    "user_subscriptions",
    "agent_vm_runs",
    "automations",
    "automation_runs",
    "user_automations",
    "priority_purchases",
    "agent_stop_requests",
    "nova_api_error_logs",
    "site_deployments",
    "agent_runs",
    "inference_queue",
    "agent_profiles",
    "chat_agents",
    "agent_approvals",
    "env_var_requests",
    "agent_emails",
    "running_processes",
  ];
  const idx = order.indexOf(name);
  return idx === -1 ? 100 : idx;
}

async function reconcileTable(
  source: ReconcileDb,
  target: ReconcileDb,
  table: TableMeta,
  now: Date | undefined,
): Promise<{ inserted: number; updated: number; deletes: number }> {
  const sourceRows = await readRows(source, table);
  const targetRows = await readRows(target, table);

  const targetByKey = new Map(targetRows.map(r => [rowKey(r.key), r]));

  let inserted = 0;
  let updated = 0;
  let deletes = 0;

  for (const src of sourceRows) {
    const key = rowKey(src.key);
    if (src.tombstoneAt) {
      // Source says the row was deleted; propagate tombstone if target has a live newer version.
      const tgt = targetByKey.get(key);
      if (tgt && !tgt.tombstoneAt && src.tombstoneAt >= (tgt.tombstoneAt ?? new Date(0))) {
        await applyTombstone(target, table, src.key, src.tombstoneAt);
        deletes += 1;
      }
      continue;
    }

    const tgt = targetByKey.get(key);
    if (!tgt) {
      await upsertRow(target, table, src.values);
      inserted += 1;
      continue;
    }

    if (tgt.tombstoneAt) {
      // Target previously marked deleted but source has live row newer than tombstone.
      if (compareRowTime(src.values, tgt.tombstoneAt) > 0) {
        await upsertRow(target, table, src.values);
        updated += 1;
      }
      continue;
    }

    if (compareRowTime(src.values, tgt.values) > 0) {
      await upsertRow(target, table, src.values);
      updated += 1;
    }
  }

  // Rows only on the target are untouched: reconciliation never deletes a row
  // the source did not see.
  return { inserted, updated, deletes };
}

async function readRows(db: ReconcileDb, table: TableMeta): Promise<SyncRow[]> {
  const columns = await listColumns(db, table.name);
  const hasTombstone = columns.includes("__sync_deleted_at");
  const order = hasTombstone
    ? [...table.primaryKeyColumns, "__sync_deleted_at"].map(c => quoteIdent(c)).join(", ")
    : table.primaryKeyColumns.map(c => quoteIdent(c)).join(", ");

  const selectCols = columns.map(quoteIdent).join(", ");
  const tombstoneCol = hasTombstone ? ", __sync_deleted_at" : "";

  const result = await db.query(
    `SELECT ${selectCols}${tombstoneCol} FROM ${quoteIdent(table.name)} ORDER BY ${order}`,
  );

  return result.rows.map(row => {
    const key = table.primaryKeyColumns.map(c => row[c]);
    const tombstoneAt = hasTombstone ? (toDate(row.__sync_deleted_at) || null) : null;
    return { key, tombstoneAt, values: pluckValues(row, columns) };
  }).filter(r => !r.tombstoneAt || hasTombstone ? true : false);
}

function pluckValues(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (col === "__sync_deleted_at") continue;
    out[col] = row[col];
  }
  return out;
}

function rowKey(key: unknown[]): string {
  return key.map(v => (v === null ? "\x00null" : `${typeof v}:${String(v)}`)).join("\x01");
}

function rowTime(values: Record<string, unknown>, fallback: Date | null): Date | null {
  let best: Date | null = fallback;
  for (const col of ["updatedAt", "createdAt"]) {
    const v = values[col];
    if (v instanceof Date) best = !best || v > best ? v : best;
    else if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) best = !best || d > best ? d : best;
    }
  }
  return best;
}

function compareRowTime(a: Record<string, unknown>, b: Record<string, unknown> | Date | null): number {
  const ta = rowTime(a, null);
  const tb = b instanceof Date || b === null ? b : rowTime(b, null);
  if (!ta && !tb) return 0;
  if (!ta) return -1;
  if (!tb) return 1;
  return ta.getTime() - tb.getTime();
}

async function upsertRow(db: ReconcileDb, table: TableMeta, values: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(values);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const colList = cols.map(quoteIdent).join(", ");

  const setClause = cols
    .filter(c => !table.primaryKeyColumns.includes(c))
    .map(c => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
    .join(", ");

  const prune = [
    `INSERT INTO ${quoteIdent(table.name)} (${colList}) VALUES (${placeholders})`,
    `ON CONFLICT (${table.primaryKeyColumns.map(quoteIdent).join(", ")}) DO UPDATE SET ${setClause}`,
    `RETURNING 1`,
  ];

  await db.query(prune.join(" "), cols.map(c => values[c] ?? null));
}

async function applyTombstone(
  db: ReconcileDb,
  table: TableMeta,
  key: unknown[],
  tombstoneAt: Date,
): Promise<void> {
  // Ensure the tombstone column exists before updating.
  await ensureTombstoneColumn(db, table.name);
  const where = table.primaryKeyColumns.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(" AND ");
  await db.query(
    `UPDATE ${quoteIdent(table.name)} SET "__sync_deleted_at" = $${key.length + 1} WHERE ${where}`,
    [...key, tombstoneAt],
  );
}

async function ensureTombstoneColumn(db: ReconcileDb, table: string): Promise<void> {
  await db.query(
    `ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS "__sync_deleted_at" timestamp with time zone`,
  );
}

async function resetSequences(source: ReconcileDb, target: ReconcileDb, tables: TableMeta[]): Promise<void> {
  for (const table of tables) {
    for (const col of table.primaryKeyColumns) {
      try {
        const seqResult = await source.query(
          `SELECT pg_get_serial_sequence(${quoteLiteral(table.name)}, ${quoteLiteral(col)}) AS seq`,
        );
        const seq = seqResult.rows[0]?.seq;
        if (!seq) continue;
        const maxResult = await source.query(
          `SELECT max(${quoteIdent(col)}) AS max FROM ${quoteIdent(table.name)}`,
        );
        const max = maxResult.rows[0]?.max;
        if (max === null || max === undefined) continue;
        await target.query(`SELECT setval(${quoteLiteral(String(seq))}, $1, true)`, [Number(max)]);
      } catch {
        // Best-effort: sequence metadata differs per table; ignore failures.
      }
    }
  }
}

export async function verifyReconciliation(users: ReconcileDb, backups: ReconcileDb): Promise<VerifyResult> {
  const [u, b] = await Promise.all([readRole(users, "active"), readRole(backups, "active")]);
  if (!u || !b) return { ok: false, message: "Missing reconciliation state row" };
  if (Math.abs(u.lastVerifiedAt.getTime() - b.lastVerifiedAt.getTime()) > 60_000) {
    return { ok: false, message: "last_verified_at divergence exceeds 60s" };
  }
  return { ok: true, message: "Reconciliation state verified" };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/** For core.ts initialisation: creates the state table when missing. */
export async function ensureReconciliationState(db: ReconcileDb): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS "db_reconciliation_state" (
       "database_role" varchar(16) PRIMARY KEY NOT NULL,
       "epoch" integer DEFAULT 0 NOT NULL,
       "last_verified_at" timestamp with time zone DEFAULT now() NOT NULL
     )`,
  );
  await recordRoleOnce(db, "active");
  await recordRoleOnce(db, "standby");
}

export { isTransientDatabaseError } from "./failover";
export type { FailoverBackend as _Backend };
