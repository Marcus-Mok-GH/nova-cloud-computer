CREATE TYPE "public"."automation_kind" AS ENUM('workspace_digest');--> statement-breakpoint
CREATE TYPE "public"."automation_run_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"automationId" integer NOT NULL,
	"workspaceId" integer NOT NULL,
	"runKey" varchar(96) NOT NULL,
	"status" "automation_run_status" DEFAULT 'running' NOT NULL,
	"summary" text,
	"errorMessage" varchar(1200),
	"artifactFileId" integer,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"kind" "automation_kind" DEFAULT 'workspace_digest' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"lastRunAt" timestamp with time zone,
	"lastError" varchar(1200),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationId_automations_id_fk" FOREIGN KEY ("automationId") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_artifactFileId_workspace_files_id_fk" FOREIGN KEY ("artifactFileId") REFERENCES "public"."workspace_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_automation_run_key_unique" ON "automation_runs" USING btree ("automationId","runKey");--> statement-breakpoint
CREATE INDEX "automation_runs_workspace_created_idx" ON "automation_runs" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "automations_workspace_kind_unique" ON "automations" USING btree ("workspaceId","kind");--> statement-breakpoint
CREATE INDEX "automations_enabled_idx" ON "automations" USING btree ("enabled");