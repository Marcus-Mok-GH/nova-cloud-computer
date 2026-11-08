import { describe, expect, it, vi } from "vitest";
import {
  ensureReconciliationState,
  readRole,
  recordRole,
  recordRoleOnce,
  reconcileDatabases,
  verifyReconciliation,
} from "./reconciliation";

type Row = Record<string, unknown>;

function makeDb(seed: Record<string, Row[]> = {}) {
  const tables = new Map<string, Row[]>();
  const state = new Map<string, { epoch: number; lastVerifiedAt: Date }>();
  const keySeq = new Map<string, number>();

  for (const [name, rows] of Object.entries(seed)) tables.set(name, rows.map(r => ({ ...r })));

  return {
    tables,
    state,
    async query(text: string, params?: unknown[]): Promise<{ rows: Row[] }> {
      const sql = text.trim();

      if (/CREATE TABLE IF NOT EXISTS "db_reconciliation_state"/i.test(sql)) return { rows: [] };
      if (/INSERT INTO "db_reconciliation_state"/i.test(sql)) {
        const match = sql.match(/VALUES \('?(active|standby)'?/);
        const role = match?.[1] ?? "active";
        if (!state.has(role)) state.set(role, { epoch: 0, lastVerifiedAt: new Date("2026-01-01T00:00:00Z") });
        return { rows: [] };
      }
      if (/UPDATE "db_reconciliation_state"[\s\S]*SET "epoch" = "epoch" \+ 1/i.test(sql)) {
        const match = sql.match(/WHERE "database_role" = '?(active|standby)'?/i);
        const role = match?.[1] ?? "active";
        const current = state.get(role) ?? { epoch: 0, lastVerifiedAt: new Date() };
        const next = { epoch: current.epoch + 1, lastVerifiedAt: new Date() };
        state.set(role, next);
        return { rows: [{ epoch: next.epoch, last_verified_at: next.lastVerifiedAt }] };
      }
      if (/SELECT "epoch", "last_verified_at" FROM "db_reconciliation_state"/i.test(sql)) {
        const match = sql.match(/WHERE "database_role" = '?(active|standby)'?/i);
        const role = match?.[1] ?? "active";
        const row = state.get(role);
        return { rows: row ? [{ epoch: row.epoch, last_verified_at: row.lastVerifiedAt }] : [] };
      }

      if (/SELECT COUNT\(1\) AS c|COUNT\(1\) AS c FROM "db_reconciliation_state"/i.test(sql)) {
        return { rows: [{ c: "0" }] };
      }

      if (/SELECT "epoch", "last_verified_at" FROM "db_reconciliation_state"/i.test(sql)) {
        const role = /VALUES \('?(active|standby)'?/.exec(sql)?.[1] ?? "active";
        const row = state.get(role);
        return { rows: row ? [{ epoch: row.epoch, last_verified_at: row.lastVerifiedAt }] : [] };
      }

      if (/pg_get_serial_sequence/i.test(sql)) return { rows: [{ seq: `test_${tables.size}_seq` }] };
      if (/SELECT max\(/i.test(sql)) return { rows: [{ max: null }] };
      if (/SELECT setval/i.test(sql)) return { rows: [{ setval: 1 }] };

      if (/ADD COLUMN IF NOT EXISTS "__sync_deleted_at"/i.test(sql)) return { rows: [] };

      if (/information_schema\.tables/i.test(sql)) {
        const names = [...tables.keys()];
        return {
          rows: names.map(name => ({
            name,
            pk: ["id"],
          })),
        };
      }

      if (/information_schema\.columns/i.test(sql)) {
        const match = /table_name = '([^']+)'/i.exec(sql);
        const name = match?.[1] ?? "";
        const rows = tables.get(name) ?? [];
        const cols = rows[0] ? Object.keys(rows[0]).filter(c => c !== "__sync_deleted_at") : ["id", "createdAt", "updatedAt"];
        return { rows: cols.map(c => ({ column_name: c })) };
      }

      if (/INSERT INTO/i.test(sql)) {
        const tableMatch = /INSERT INTO "([^"]+)"/i.exec(sql);
        const table = tableMatch?.[1] ?? "unknown";
        const cols = (sql.match(/\(([^)]+)\) VALUES/)?.[1] ?? "")
          .split(",")
          .map(s => s.trim().replace(/^"|"$/g, ""));
        const values = (params ?? []) as unknown[];
        const row: Row = {};
        cols.forEach((col, idx) => {
          row[col] = values[idx];
        });
        if (row.id === undefined && cols.includes("id")) {
          const seq = (keySeq.get(table) ?? 0) + 1;
          keySeq.set(table, seq);
          row.id = seq;
        }
        const list = tables.get(table) ?? [];
        const idx = list.findIndex(r => "id" in row && r.id === row.id);
        if (idx === -1) list.push(row);
        else list[idx] = row;
        tables.set(table, list);
        return { rows: [{ inserted: 1 }] };
      }

      if (/UPDATE "[^"]*" SET "__sync_deleted_at"/i.test(sql)) {
        const tableMatch = /UPDATE "([^"]+)"/i.exec(sql);
        const table = tableMatch?.[1] ?? "unknown";
        const list = tables.get(table) ?? [];
        const id = (params ?? [])[0] as number | string;
        const tombstone = (params ?? [])[1] as Date;
        const row = list.find(r => r.id === id);
        if (row) (row as Row).__sync_deleted_at = tombstone;
        tables.set(table, list);
        return { rows: [] };
      }

      if (/SELECT .+ FROM "/i.test(sql)) {
        const tableMatch = /FROM "([^"]+)"/i.exec(sql);
        const table = tableMatch?.[1] ?? "";
        const list = tables.get(table) ?? [];
        return { rows: list.map(r => ({ ...r })) };
      }

      if (/UPDATE "db_reconciliation_state"/i.test(sql)) {
        for (const entry of state.values()) entry.lastVerifiedAt = new Date();
        return { rows: [] };
      }

      if (/CREATE TABLE IF NOT EXISTS "db_reconciliation_state"/i.test(sql)) return { rows: [] };

      if (/SELECT now\(\)/i.test(sql)) {
        return { rows: [{ now: new Date() }] };
      }

      if (/INSERT INTO "db_reconciliation_state"/i.test(sql)) return { rows: [] };

      if (/SELECT "last_verified_at" FROM "db_reconciliation_state"/i.test(sql)) {
        return { rows: [] };
      }

      if (/SELECT COUNT\(1\) AS c/i.test(sql)) return { rows: [{ c: "0" }] };

      return { rows: [] };
    },

    async end() {},
  };
}

describe("reconciliation", () => {
  it("recordRoleOnce is idempotent and recordRole bumps epoch", async () => {
    const db = makeDb();
    await ensureReconciliationState(db);
    await recordRoleOnce(db, "active");
    await recordRoleOnce(db, "active");
    const role = await readRole(db, "active");
    expect(role?.epoch).toBe(0);

    const next = await recordRole(db, "active");
    expect(next.epoch).toBe(1);

    const read = await readRole(db, "active");
    expect(read?.epoch).toBe(1);
  });

  it("pushes newer rows from source to target and inserts missing rows", async () => {
    const primary = makeDb({
      chats: [
        { id: "c1", title: "old", updatedAt: new Date("2026-01-01T00:00:00Z") },
        { id: "c2", title: "new", updatedAt: new Date("2026-02-01T00:00:00Z") },
      ],
    });
    const backup = makeDb({
      chats: [
        { id: "c1", title: "old", updatedAt: new Date("2026-01-01T00:00:00Z") },
      ],
    });

    const result = await reconcileDatabases(primary, backup, { source: "primary" });
    expect(result.source).toBe("primary");
    expect(result.tables.chats.inserted).toBe(1);
    expect(backup.tables.get("chats")).toHaveLength(2);
  });

  it("respects row-level updatedAt: older source rows do not overwrite newer target rows", async () => {
    const primary = makeDb({
      chats: [{ id: "c1", title: "stale", updatedAt: new Date("2026-01-01T00:00:00Z") }],
    });
    const backup = makeDb({
      chats: [{ id: "c1", title: "fresh", updatedAt: new Date("2026-03-01T00:00:00Z") }],
    });

    const result = await reconcileDatabases(primary, backup, { source: "primary" });
    expect(result.tables.chats.updated).toBe(0);
    expect(backup.tables.get("chats")![0]!.title).toBe("fresh");
  });

  it("backup becomes source when its epoch is newer (reverse direction)", async () => {
    const primary = makeDb({
      chats: [{ id: "c1", title: "primary", updatedAt: new Date("2026-01-01T00:00:00Z") }],
    });
    const backup = makeDb({
      chats: [{ id: "c1", title: "backup", updatedAt: new Date("2026-02-01T00:00:00Z") }],
    });
    await ensureReconciliationState(primary);
    await ensureReconciliationState(backup);
    await recordRole(backup, "active");
    await recordRole(backup, "active");
    await recordRole(primary, "standby");

    const result = await reconcileDatabases(primary, backup);
    expect(result.source).toBe("backup");
  });

  it("tombstones propagate deletes only when newer", async () => {
    const primary = makeDb({
      chats: [{ id: "c1", title: "live", updatedAt: new Date("2026-02-01T00:00:00Z") }],
    });
    const backup = makeDb({
      chats: [
        { id: "c1", title: "deleted", updatedAt: new Date("2026-01-01T00:00:00Z"), __sync_deleted_at: new Date("2026-03-01T00:00:00Z") },
      ],
    });

    const result = await reconcileDatabases(primary, backup, { source: "primary" });
    expect(result.tables.chats.deletes).toBe(0);
  });

  it("verifyReconciliation checks last_verified_at divergence", async () => {
    const primary = makeDb();
    const backup = makeDb();
    await ensureReconciliationState(primary);
    await ensureReconciliationState(backup);
    const result = await verifyReconciliation(primary, backup);
    expect(result.ok).toBe(true);
  });
});
