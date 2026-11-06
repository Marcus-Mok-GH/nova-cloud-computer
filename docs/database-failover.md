# Database failover to a backup Postgres

Nova normally serves every query from the primary Postgres (Neon) behind
`DATABASE_URL`. When the primary goes away — most commonly when the Neon
project's monthly data-transfer allowance is exhausted and its compute is
suspended — the app can fail over to a warm standby kept current with logical
replication. Set `BACKUP_DATABASE_URL` and the pool routes around the outage
automatically.

## How it works

- `server/db/failover.ts` wraps the primary `pg.Pool` in a facade that owns a
  lazily created backup pool. A transient connection error (connection
  refused/reset/timeout, `57P03 cannot_connect_now`, `53300
  too_many_connections`, …) marks the primary down for
  `NOVA_DB_FAILOVER_COOLDOWN_MS` (default 60 s) and retries the failed query
  once on the backup. After the cooldown, the next query probes the primary
  first; a success switches traffic back.
- Only transient errors trigger failover. Integrity violations, syntax errors,
  and permission errors are real answers and surface immediately.
- Transactions pin one backend. If the backend dies mid-transaction the
  transaction fails — retrying it is the caller's job (same semantics as a
  single-pool outage), so a failover can surface as one failed request.
- `/api/health` reports which backend answered via `database.backend`
  (`"primary" | "backup"`). Watch for `backup` — it means the primary is down.

## Why the standby does not double the egress usage

The 5 GB transfer allowance is **per Neon project**, not per account. Keep the
standby in a **separate Neon project** (a second free project in another
organization, or any other Postgres host) and it has its own allowance.

While the primary is up, the standby consumes only the replication stream —
the logical changes your workload writes (WAL), typically tens to low hundreds
of MB/month for a chat workload versus the ~5 GB of query result egress. When
the primary is suspended, replication stops (nothing left to send) and the app
serves from the standby's own untouched quota.

## One-time setup

Requires `psql`, `pg_dump`, and `pg_isready` on PATH (Postgres 16 client tools).

```bash
# Primary (the project Vercel already points at) and a fresh standby project:
export DATABASE_URL="postgresql://…primary…"        # direct, un-pooled URL
export BACKUP_DATABASE_URL="postgresql://…standby…"
./scripts/setup-db-replication.sh
```

The script:

1. Enables logical replication on the primary (requires the project-owner
   connection string) and creates the `nova_backup_pub` publication plus the
   `nova_backup_slot` replication slot.
2. Applies the schema to the standby (schema-only `pg_dump` — DDL does not
   replicate).
3. Creates the `nova_backup_sub` subscription on the standby. The initial
   table copy is a one-time full read of the primary (~the size of your data)
   counted against the primary's allowance; after that only the change stream
   flows.

Then set `BACKUP_DATABASE_URL` in the Vercel project (Production) and redeploy.

## Caveats

- **DDL does not replicate.** After any schema migration, apply it to the
  standby too: `DATABASE_URL=$BACKUP_DATABASE_URL pnpm exec tsx server/migrate.ts`.
  Drifted schema makes the standby fail in confusing ways mid-outage.
- **Sequences do not replicate.** Logical replication carries row data, not
  sequence positions. After a failback, re-sync sequences on the primary (see
  the failback procedure) or inserts will collide.
- **Neon Auth.** If the deployment uses Neon Auth, the auth tables live in the
  primary's managed schema. A standby on another project does not carry them,
  so sign-in/session lookups may still fail while the workspace data itself
  stays available. Use a non-Neon standby (Supabase, self-hosted Postgres) if
  auth availability matters.
- **Cooling off writes.** The standby is read-mostly: while failed over, the
  app writes to it. Those writes do **not** flow back to the primary
  automatically.

## Failback procedure

When the primary is healthy again (new billing cycle / upgraded plan):

1. Let the app switch back on its own (cooldown expiry probes the primary) or
   redeploy to force a fresh pool.
2. Any rows written to the standby during the outage exist only on the
   standby. To preserve them, dump the changed tables from the standby and
   load them into the primary before reopening traffic:
   `pg_dump --data-only --table=<table> $BACKUP_DATABASE_URL | psql $DATABASE_URL`.
3. Re-sync sequence positions on the primary, e.g.
   `SELECT setval(pg_get_serial_sequence('<table>','id'), (SELECT max(id) FROM <table>));`
   for every serial/identity column.
4. Re-run the setup script's subscription step if the standby fell far behind
   or the slot was dropped.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Primary connection string (pooled). Required. |
| `DATABASE_URL_UNPOOLED` | Primary direct URL (migrations). Optional. |
| `BACKUP_DATABASE_URL` | Standby connection string. When set, failover is enabled. |
| `NOVA_DB_FAILOVER_COOLDOWN_MS` | How long to stay on the standby before re-probing the primary (default 60000). |
