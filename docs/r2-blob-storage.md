# R2 blob storage

Workspace file bodies are stored in Cloudflare R2 (S3-compatible) instead of Postgres.
The database keeps metadata only; the body lives under a `storage_key`.

Code:

- `server/storage/r2.ts` — dependency-free SigV4 client (`putObject`, `getObject`, `deleteObject`).
- `server/db/workspaceFiles.ts` — uploads on create/update, reads through on fetch, deletes on remove.
- `scripts/r2-migrate-blobs.ts` — backfills existing rows into R2.

If any variable below is unset, blob storage is disabled and the app falls back to the
legacy `content` column. Nothing breaks; you just keep paying Postgres egress.

## 1. Create a Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up>.
2. Enter an email and password, then confirm the verification email.
3. Skip adding a domain — R2 works on the account alone. No paid plan is required to start;
   R2 has a free tier (10 GB storage, 1M Class A ops, 10M Class B ops, **zero egress fees**).

## 2. Create the bucket

1. In the dashboard sidebar open **R2 Object Storage**.
2. If prompted, complete the one-time R2 activation (it asks for a payment method for
   overage billing; the free tier is not charged).
3. Click **Create bucket**.
   - Name: e.g. `nova-workspace-files` (lowercase, hyphens).
   - Location: pick the region closest to your app (or leave default / Automatic).
4. Copy the bucket name — this is `R2_BUCKET`.

## 3. Create the API token

1. On the R2 page click **Manage R2 API Tokens** → **Create API token**.
2. Permissions: **Object Read & Write**.
3. Scope it to the bucket you just created (not "all buckets").
4. Create, then copy the values shown **once**:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
5. The S3 endpoint is shown on the bucket's **Settings** page as
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
   - `R2_ENDPOINT` = that URL **including** `https://` and **without** the bucket name.
     The account ID is also visible in the dashboard URL and under **R2 → Overview**.

## 4. Set the variables

The client reads exactly these four names:

```
R2_BUCKET=nova-workspace-files
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<access key id>
R2_SECRET_ACCESS_KEY=<secret access key>
```

Locally: add them to `.env` (never commit it).
On Zo: add each as a secret in **Settings → Advanced → Secrets**.
On Vercel: **Project → Settings → Environment Variables** (all four, Production + Preview).

Restart the app after setting them so `process.env` picks them up.

## 5. Backfill existing files

With the variables set and the app stopped:

```bash
cd /home/workspace/Projects/nova-cloud-computer
bun scripts/r2-migrate-blobs.ts
```

The script is idempotent — rows that already have a `storage_key` are skipped, so it is safe
to re-run. It prints how many rows it migrated.

## 6. Verify

- Upload or edit a workspace file, then check the object exists in the R2 bucket browser.
- Confirm `workspace_files.storage_key` is populated for that row.
- Clear the `content` column for one test row and re-open the file in the app: it should
  still render, proving reads go through R2.

## Notes

- Egress from R2 is free, which is the reason for the migration.
- Do not enable public access on the bucket. All reads are server-side and authenticated
  with the API token.
- Rotating the token: create a new one, update all four env vars where applicable, restart,
  then revoke the old token.