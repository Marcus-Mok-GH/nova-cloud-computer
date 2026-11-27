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

/**
 * Postgres `undefined_table` (42P01) - the relation does not exist.
 *
 * This is the crash the automatic schema bootstrap is meant to prevent: a
 * table the code queries before its migration has run. The bootstrap
 * deliberately swallows a failed migration (the database may be down), so the
 * code that touches a new table has to recognise the missing relation and
 * degrade instead of throwing.
 */
export function isMissingRelation(error: unknown): boolean {
  return causeCodeMatches(error, "42P01");
}

/**
 * Postgres `undefined_column` (42703) - the column does not exist.
 *
 * The same crash class as a missing table, one level down: a column added to
 * a table by a migration that has not run yet. A query that selects it fails
 * with `column ... does not exist`, which is NOT a missing relation, so code
 * that degrades on a missing table has to degrade on this too.
 */
export function isMissingColumn(error: unknown): boolean {
  return causeCodeMatches(error, "42703");
}
