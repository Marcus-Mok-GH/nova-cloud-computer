# Role flip: promoting the standby to primary

`docs/database-failover.md` covers automatic failover and failback inside the
existing primary/standby pair. This runbook covers the deliberate, permanent
swap: the standby becomes the primary and the old primary becomes the cold
standby, so the project that pays the egress bill stops doing so.

## Why flip instead of fail back

Both databases are on free plans with a per-project 5 GB/month network
transfer allowance. Serving the app burns ~6 GB/month, so whichever project
is primary will always exhaust its allowance first and get suspended until
its next monthly cycle. Flipping roles moves that burn to the project that
still has a fresh allowance (or to a non-metered host such as Aiven / Supabase
- see `research_database_services.md`), and leaves the exhausted project cold
until its allowance resets.

## Preconditions

- `psql`, `pg_dump`, `pg_isready` on PATH (Postgres 16 client tools).
- The new primary is **caught up** (`SELECT latest_end_time FROM
  pg_stat_subscription;` on the old standby, close to now) **before** the old
  primary dies. If the publisher died first and the standby never received the
  initial copy, the data only exists on the suspended project and nothing in
  this runbook can recover it - see "Recovery from a fully frozen pair" below.
- A maintenance window long enough for one deploy; writes that land between
  the last replication tick and the swap are lost (minutes at most).

## Steps

1. **Dump the new primary (safety net).**

   ```bash
   pg_dump -Fc --no-owner --no-privileges "$NEW_PRIMARY_URL" > pre-flip.dump
   ```

2. **Stop replication in the old direction** so the old primary cannot
   resurrect as a publisher over the new primary's data:

   ```bash
   psql "$OLD_STANDBY_URL" -c "DROP SUBSCRIPTION IF EXISTS nova_backup_sub;"
   psql "$OLD_PRIMARY_URL" -c "DROP PUBLICATION IF EXISTS nova_backup_pub;
     SELECT pg_drop_replication_slot('nova_backup_slot');"
   ```

   (If the old primary is already unreachable because its quota is gone, do
   this on the next cycle reset instead - the leftover publication is inert.)

3. **Swap the connection strings in the Vercel project and redeploy**    (the app's automatic failover would eventually route around the old
   primary anyway; swapping the env makes the promotion explicit):

   ```bash
   # OLD value of DATABASE_URL (backup project) becomes the new primary
   vercel env rm DATABASE_URL production
   echo "$NEW_PRIMARY_POOLED_URL" | vercel env add DATABASE_URL production
   echo "$NEW_PRIMARY_DIRECT_URL" | vercel env add DATABASE_URL_UNPOOLED production
   echo "$NEW_STANDBY_POOLED_URL" | vercel env add BACKUP_DATABASE_URL production
   vercel --prod
   ```

4. **Re-establish replication in the reverse direction** (new primary ->
   new standby) so the cold project stays current for the next swap:

   ```bash
   export DATABASE_URL="$NEW_PRIMARY_DIRECT_URL"
   export BACKUP_DATABASE_URL="$NEW_STANDBY_URL"
   ./scripts/setup-db-replication.sh
   ```

   On non-Neon primaries (Aiven), enable logical replication in the provider
   console first (`ALTER SYSTEM` in the script assumes project-owner rights
   that the script's Neon path relies on).

5. **Apply schema migrations to the old primary once it revives** - DDL does
   not replicate, so the cold project needs the current schema applied before
   the reverse subscription is created against it.

6. **Verify**: `/api/health` reports `database.backend: "primary"`, and the
   old primary's subscription shows `latest_end_time` advancing.

## Recovery from a fully frozen pair

When the publisher dies and the standby never caught up, the authoritative
data is locked behind the suspension. The only levers:

- **Temporarily lift the quota** (upgrade to Launch for the dump window, then
  downgrade; Neon support can also lift it one-time - `support@neon.tech`,
  which is exactly how Vercel-marketplace projects usually do it).
- **Wait for the allowance reset** - compute and network transfer reset at the
  start of each monthly billing cycle; storage is unaffected while suspended.

As soon as the project answers again, `pg_dump` the **entire** state (public
schema + any `neon_auth` schema) and restore it into the new primary before
flipping, because signups against an empty primary create a second account
the restored rows will collide with.
