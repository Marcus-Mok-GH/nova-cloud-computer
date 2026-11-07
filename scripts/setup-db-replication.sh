#!/usr/bin/env bash
# Bootstraps logical replication from the primary Postgres (DATABASE_URL) to a
# standby (BACKUP_DATABASE_URL) for Nova database failover. Idempotent:
# re-running skips objects that already exist. See docs/database-failover.md.
set -euo pipefail

PUBLICATION="nova_backup_pub"
SLOT="nova_backup_slot"
SUBSCRIPTION="nova_backup_sub"

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }; }
require_tool psql
require_tool pg_dump
require_tool pg_isready

: "${DATABASE_URL:?set DATABASE_URL to the primary direct (un-pooled) connection string}"
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL to the standby connection string}"

echo "==> Checking connectivity"
pg_isready -d "$DATABASE_URL" >/dev/null
pg_isready -d "$BACKUP_DATABASE_URL" >/dev/null

echo "==> Enabling logical replication on the primary (project-owner connection required)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET wal_level = logical;" || {
  echo "could not set wal_level=logical; enable Logical replication in the Neon project settings instead" >&2
  exit 1
}
# Neon applies wal_level changes without a restart; the publication check below
# fails loudly if it has not taken effect yet.

echo "==> Creating publication $PUBLICATION on the primary"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "SELECT count(*) FROM pg_publication WHERE pubname = '$PUBLICATION'" | grep -q "^1$" || psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE PUBLICATION $PUBLICATION FOR ALL TABLES"

echo "==> Creating replication slot $SLOT on the primary"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "SELECT count(*) FROM pg_replication_slots WHERE slot_name = '$SLOT'" | grep -q "^1$" || psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT pg_create_logical_replication_slot('$SLOT', 'pgoutput')"

echo "==> Applying schema to the standby (data copy happens via the subscription)"
pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" | grep -v -E "^(CREATE|ALTER|DROP) (PUBLICATION|SUBSCRIPTION)" | psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -q

echo "==> Creating subscription $SUBSCRIPTION on the standby"
psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "SELECT count(*) FROM pg_subscription WHERE subname = '$SUBSCRIPTION'" | grep -q "^1$" || psql "$BACKUP_DATABASE_URL" -v PRIMARY_URL="$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE SUBSCRIPTION $SUBSCRIPTION CONNECTION :'PRIMARY_URL' PUBLICATION $PUBLICATION WITH (create_slot = false, slot_name = '$SLOT')"

echo "==> Verifying subscription state"
psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT subname, subenabled FROM pg_subscription WHERE subname = '$SUBSCRIPTION'"

echo "Done. Set BACKUP_DATABASE_URL in the Vercel project and redeploy."
echo "Note: run future schema migrations against the standby too; DDL does not replicate."

echo "==> Creating publication $PUBLICATION on the primary"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "SELECT count(*) FROM pg_publication WHERE pubname = '$PUBLICATION'" | grep -q "^1$" || psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE PUBLICATION $PUBLICATION FOR ALL TABLES"

echo "==> Creating replication slot $SLOT on the primary"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "SELECT count(*) FROM pg_replication_slots WHERE slot_name = '$SLOT'" | grep -q "^1$" || psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT pg_create_logical_replication_slot('$SLOT', 'pgoutput')"

echo "==> Applying schema to the standby (data copy happens via the subscription)"
pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" | grep -v -E "^(CREATE|ALTER|DROP) (PUBLICATION|SUBSCRIPTION)" | psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -q

echo "==> Creating subscription $SUBSCRIPTION on the standby"
psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "SELECT count(*) FROM pg_subscription WHERE subname = '$SUBSCRIPTION'" | grep -q "^1$" || psql "$BACKUP_DATABASE_URL" -v PRIMARY_URL="$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE SUBSCRIPTION $SUBSCRIPTION CONNECTION :'PRIMARY_URL' PUBLICATION $PUBLICATION WITH (create_slot = false, slot_name = '$SLOT')"

echo "==> Verifying subscription state"
psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT subname, subenabled FROM pg_subscription WHERE subname = '$SUBSCRIPTION'"

echo "Done. Set BACKUP_DATABASE_URL in the Vercel project and redeploy."
echo "Note: run future schema migrations against the standby too; DDL does not replicate."
