/**
 * Postgres error classification, kept import-free so any module can use it
 * without pulling the connection pool (or its failover/reconciliation graph)
 * into its module graph.
 *
 * Drizzle wraps driver errors: a failed query throws a `DrizzleQueryError`
 * whose `.cause` holds the real pg `DatabaseError` carrying `code`. A direct
 * `error.code === "23505"` check therefore never fires in production, so both
 * predicates walk the cause chain instead.
 */

/** Depth of the cause chain walked before giving up. */
const MAX_CAUSE_DEPTH = 4;

function causeCodeMatches(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if ((current as Error & { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Postgres `unique_violation` (23505) - the name/row is already taken. */
export function isUniqueViolation(error: unknown): boolean {
  return causeCodeMatches(error, "23505");
}

/** Postgres `foreign_key_violation` (23503) - a referenced row is missing. */
export function isForeignKeyViolation(error: unknown): boolean {
  return causeCodeMatches(error, "23503");
}
