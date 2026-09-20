ALTER TABLE "site_deployments" ADD COLUMN "deploymentKey" varchar(16);--> statement-breakpoint
ALTER TABLE "site_deployments" ADD COLUMN "description" varchar(240);--> statement-breakpoint
-- Backfill: every existing Netlify site becomes a targetable deployment with
-- a stable key ('d-01', 'd-02', ...) numbered by each site's first deploy per
-- workspace. Every run row of the same site carries the same key.
WITH "first_deploys" AS (
  SELECT "workspaceId", "siteId", MIN("createdAt") AS "firstAt"
  FROM "site_deployments"
  GROUP BY "workspaceId", "siteId"
),
"numbered" AS (
  SELECT
    "workspaceId",
    "siteId",
    'd-' || LPAD(ROW_NUMBER() OVER (PARTITION BY "workspaceId" ORDER BY "firstAt")::text, 2, '0') AS "key"
  FROM "first_deploys"
)
UPDATE "site_deployments" "sd"
SET "deploymentKey" = "n"."key"
FROM "numbered" "n"
WHERE "sd"."workspaceId" = "n"."workspaceId" AND "sd"."siteId" = "n"."siteId";
