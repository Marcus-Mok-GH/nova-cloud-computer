CREATE TYPE "site_deployment_status" AS ENUM ('deploying', 'live', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_deployments" (
    "id" serial PRIMARY KEY,
    "workspaceId" integer NOT NULL REFERENCES "workspaces" ("id") ON DELETE CASCADE,
    "siteId" varchar(64) NOT NULL,
    "siteName" varchar(160),
    "siteUrl" varchar(512) NOT NULL,
    "status" "site_deployment_status" DEFAULT 'deploying' NOT NULL,
    "fileCount" integer DEFAULT 0 NOT NULL,
    "error" varchar(1200),
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_deployments_workspace_created_idx" ON "site_deployments" ("workspaceId", "createdAt");
