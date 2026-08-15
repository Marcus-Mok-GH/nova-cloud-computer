DO $$ BEGIN
  CREATE TYPE "agent_vm_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_vm_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"provider" varchar(32) DEFAULT 'daytona' NOT NULL,
	"sandboxId" varchar(256),
	"task" text NOT NULL,
	"status" "agent_vm_run_status" DEFAULT 'queued' NOT NULL,
	"resultSummary" text,
	"errorMessage" varchar(1200),
	"artifactFileId" integer,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_vm_runs" ADD CONSTRAINT "agent_vm_runs_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_vm_runs" ADD CONSTRAINT "agent_vm_runs_artifactFileId_workspace_files_id_fk" FOREIGN KEY ("artifactFileId") REFERENCES "public"."workspace_files"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_vm_runs_workspace_created_idx" ON "agent_vm_runs" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_vm_runs_one_active_per_workspace" ON "agent_vm_runs" USING btree ("workspaceId") WHERE "status" IN ('queued', 'running');
