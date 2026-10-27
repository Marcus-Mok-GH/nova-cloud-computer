# Database services more lenient than Neon (research, Oct 2026)

Scope: options Nova could actually use — a REST/tRPC backend on Vercel with Drizzle ORM +
`pg` (pooled `DATABASE_URL`, unpooled for migrations). "Lenient" = quotas that are more
generous, and fewer hard cutoffs (no compute-hour meter that suspends the DB, no short
inactivity pause, no expiry, no credit card).

## 1. Neon baseline (Free plan)

- 1 GB storage per project (doubled from 0.5 GB on 2 Oct 2026), 20 GB across all projects
- 100 compute-unit (CU)-hours per project per month — **hitting it suspends compute until
  the next billing cycle, dropping all connections**
- 100 projects, 10 branches per project, 5 GB egress per project, 1 snapshot
- Scale-to-zero after 5 idle minutes (cannot be disabled on Free), ~500 ms–2 s wake
- No credit card, never expires

The two constraints that bite a live app: **1 GB storage** and **100 CU-hours** (at the
default 0.25 CU that's ~400 active hours ≈ half a month of always-on).

## 2. Postgres — drop-in (same Drizzle schema + `pg` pool)

| Service | Free storage | Compute / quota | The catch vs Neon |
|---|---|---|---|
| **Supabase Free** | 500 MB (2 projects) | Shared CPU, **no compute-hour meter**, unlimited API requests | Pauses after ~1 week of inactivity (restore from dashboard, kept up to 1 yr). Smaller storage than Neon, but no CU cap that kills a live DB |
| **Aiven Free** | 1 GB | **Dedicated single node, 1 CPU / 1 GB RAM, always a real VM** | Powers off after a period of inactivity (email warning first). Region not freely choosable. Storage cut from 5 GB → 1 GB in 2025. Includes automated backups + PostGIS |
| **Prisma Postgres** | 1.01 GB | 200k ops/month, pooled connection included, no cold starts | No backups/PITR on Free; ops quota is the cutoff, not compute |
| **Northflank Free** | 1 free Postgres database | usage-metered | Single free database; small vendor |
| **CockroachDB Basic** | 10 GB + 50M RU/mo | Postgres-wire compatible | **Closed to new clusters** (Continuum pricing, 15 Sep 2026); new orgs get only a 30-day $400 trial |
| **Xata** | — | — | **No free managed tier**: $0.012/hr + $0.28/GB/mo, 14-day $100 trial. Free only if self-hosting the Apache-2.0 core |
| **PlanetScale** | — | — | No free tier; $5/mo PS-5 entry |
| **Render Free** | 1 GB | — | **Expires 30 days after creation**, then deleted after a 14-day grace period; no backups |
| **Railway** | — | — | One-time trial credit only, then usage billing |
| **Aurora DSQL / Google Cloud SQL / RDS** | 1 GB–1.4 GB trial-style | — | Not a durable free tier; enterprise-managed, overkill |

Summary: after filtering for "permanent free tier that exists for new signups", the real
Postgres competitors are **Supabase, Aiven, Prisma Postgres (and Northflank)**.

## 3. SQLite/libSQL — requires changing Drizzle dialect (`libsql`) but far more generous

| Service | Free storage | Free quota | The catch |
|---|---|---|---|
| **Turso** | **5 GB** (5× Neon) | 100 databases, 500M row reads + 10M writes/month | Not Postgres: Drizzle `libsql` dialect, `@libsql/client` instead of `pg`. No connection strings — HTTP/embedded driver |
| **Cloudflare D1** | 5 GB total (500 MB per DB) | 10 DBs, 5M row reads/day, 100k writes/day | Only reachable via a Cloudflare Worker binding; Nova is on Vercel, so this doesn't fit |

## 4. MySQL — compatible with Drizzle's `mysql2` dialect, biggest quotas

| Service | Free quota | The catch |
|---|---|---|
| **TiDB Cloud Starter** | **25 GiB row storage + 25 GiB columnar + 250M request units/month** per org, across up to 5 instances; no card | MySQL, not Postgres: migrations, `jsonb`/array types and query syntax need rework. Premium regions cost more per RU |

## 5. Not viable (checked and excluded)

- Firebase/Firestore, MongoDB Atlas, Upstash Redis — different data model entirely; Nova's
  schema is relational.
- Self-hosted Postgres (e.g. on this Zo Computer) — unlimited and free, but the DB would
  live on a personal server that sleeps and needs public exposure; wrong for production
  user data.

## 6. Egress — the limit that actually hit Nova

Nova's schema stores file and image **bytes inside Postgres**: `workspace_files.content` and
the chat image rows hold full payloads. Every client read of those rows is database egress,
so the 5 GB/month egress allowance is consumed by normal app usage, not abuse. Storage
quotas (500 MB–1 GB) are irrelevant until this is fixed — the same 5 GB egress cap exists on
Supabase Free, so switching vendors alone reproduces the outage.

Measured allowances (verified Oct 2026):

| Service | Free egress | Behaviour at the cap |
|---|---|---|
| Neon Free | 5 GB/project/mo | Project suspended until next cycle |
| Supabase Free | 5 GB DB egress + 5 GB cached egress | Project restricted/read-only |
| Aiven Free | Unmetered within the plan's fair-use VM | No per-GB bill; VM powers off on inactivity |
| Prisma Postgres Free | No per-GB egress; 200k ops/mo | Operations quota is the cutoff |
| Turso Free | No per-GB egress; 500M reads + 10M writes/mo | Row-read quota is the cutoff |
| TiDB Cloud Starter | No per-GB egress; 250M RU/mo | Request-unit quota is the cutoff |
| Cloudflare R2 (object store) | **$0 egress, always** | None |

### Fix, in order of impact

1. **Move blobs out of Postgres into object storage.** Cloudflare R2 has zero egress fees and
   an S3-compatible API, so the client fetches bytes from R2 and Postgres only returns
   metadata (key, size, mime, checksum). This removes essentially all database egress and is
   the only change that makes *any* provider's free tier durable. Store a `storage_key`
   column instead of `content`; serve via presigned URL or a Worker.
2. **Cache/serve through a CDN** for anything that stays in the DB, and set
   `Cache-Control` on file reads.
3. **Only then pick a host** using the tables above.

Note that object storage is a separate migration from the database host: do step 1 on Neon
first, measure egress for a cycle, and the host decision becomes a compute/storage question
rather than an egress emergency.

## 7. Recommendation

1. **Stay on Postgres, minimal code change, no compute-hour gun to your head → Supabase.**
   Swap `DATABASE_URL` (Supavisor pooler for the app, direct connection for migrations).
   Trade-off: 500 MB storage instead of 1 GB, and free projects pause after ~1 week of
   *zero* database activity — for a live app with any daily users that almost never
   triggers. Also bundles Auth/Storage/Realtime, which could replace separate services.
   **Do the blob extraction in section 6 first** — Supabase's egress allowance is the same
   5 GB, so without it this outage simply recurs on a different vendor.
2. **Want always-on dedicated compute with no meter at all → Aiven.** A real 1-CPU/1-GB
   VM with backups included, free forever (same 1 GB storage as Neon). Best if "lenient"
   means "no metering/suspension surprises".
3. **Storage headroom matters most → Turso.** 5 GB free and per-database isolation, but it
   is a driver + dialect rewrite (SQLite), not a connection-string swap — a medium-sized
   refactor of `server/` and `drizzle/`.
4. **If quota is the real driver and Postgres isn't sacred → TiDB Starter**: 25 GiB free
   dwarfs everything else, at the cost of moving to MySQL.

Quotas change frequently (Neon doubled its free storage on 2 Oct 2026; Supabase acquired
Turso the same week). Verify on the pricing pages before migrating.

## Sources

- Neon pricing: https://neon.com/pricing — free limits FAQ: https://neon.com/faqs/free-plan-limits-and-quotas
- Supabase pricing: https://supabase.com/pricing — pausing docs: https://supabase.com/docs/guides/platform/free-project-pausing — bandwidth/egress docs: https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Aiven free Postgres: https://aiven.io/free-postgresql-database
- Prisma Postgres free tier / Drizzle compatibility: https://makerkit.dev/blog/tutorials/best-database-software-startups
- TiDB Starter pricing: https://www.pingcap.com/tidb-cloud-starter-pricing-details
- Turso free tier: https://layerbase.com/blog/serverless-database-pricing-compared
- Cloudflare D1 vs Turso: https://www.devopsness.com/blog/turso-vs-cloudflare-d1-edge-sqlite
- Cloudflare R2 zero-egress pricing: https://developers.cloudflare.com/r2/pricing
- CockroachDB free plan closure: https://cloudinsight.cc/en/blog/free-cloud-database
- Xata pricing (no managed free tier): https://layerbase.com/blog/xata-alternatives
- Render free Postgres expiry: https://render.com/docs/free (summary: https://justinmckelvey.com/blog/is-render-free)
- Free Postgres hosting comparison: https://swyftstack.com/blog/free-postgresql-hosting
- Supabase egress accounting (DB, Storage, Auth, pooler all count): https://supabase.com/docs/guides/platform/manage-your-usage/egress
