DO $$ BEGIN
  CREATE TYPE "public"."running_process_status" AS ENUM('running', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "running_processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"chatId" varchar(24),
	"kind" varchar(32) DEFAULT 'editor' NOT NULL,
	"status" "running_process_status" DEFAULT 'running' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"heartbeatAt" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"errorMessage" varchar(1200),
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "running_processes" ADD CONSTRAINT "running_processes_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "running_processes" ADD CONSTRAINT "running_processes_chatId_chats_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "running_processes_status_heartbeat_idx" ON "running_processes" USING btree ("status","heartbeatAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "running_processes_chat_idx" ON "running_processes" USING btree ("chatId");
