import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(neon(process.env.DATABASE_URL));
    } catch (error) {
      console.warn("[Database] Failed to initialize Neon:", error);
    }
  }
  return _db;
}

export async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Nova can't reach your workspace data right now. Please try again shortly.");
  return db;
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
  const result = (await db.execute(sql`select now() as now`)) as unknown as { rows?: Array<{ now: string | Date }> } | Array<{ now: string | Date }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const value = rows[0]?.now;
  if (!value) return new Date();
  return value instanceof Date ? value : new Date(value);
}
