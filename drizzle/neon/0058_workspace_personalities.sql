-- User-defined personalities (the composer picker's list, managed in Settings).
-- Default (Nova's own voice) is implicit and never a row here.
CREATE TABLE IF NOT EXISTS "workspace_personalities" (
  "id" varchar(40) PRIMARY KEY,
  "workspaceId" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" varchar(40) NOT NULL,
  "instructions" text,
  "detail" varchar(20),
  "collaboration" varchar(20),
  "expertise" varchar(20),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_personalities_workspace_idx" ON "workspace_personalities" ("workspaceId");
--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN IF NOT EXISTS "activePersonalityId" varchar(40) DEFAULT 'default' NOT NULL;
