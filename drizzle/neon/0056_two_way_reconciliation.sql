CREATE TABLE IF NOT EXISTS "db_reconciliation_state" (
	"database_role" varchar(16) PRIMARY KEY NOT NULL,
	"epoch" integer DEFAULT 0 NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- Epoch marker for two-way primary/backup reconciliation: the side that last
-- accepted writes wins as source when the other side recovers. Tombstone
-- columns (`__sync_deleted_at`) are added lazily by the reconciler itself,
-- so no per-table DDL is needed here.
