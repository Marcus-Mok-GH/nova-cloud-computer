CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'awaiting_continue', 'completed', 'stopped', 'failed');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"chatId" integer NOT NULL,
	"channel" varchar(32) DEFAULT 'telegram' NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"segment" integer DEFAULT 0 NOT NULL,
	"notifyChatId" varchar(64),
	"errorMessage" varchar(1200),
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_chatId_chats_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_status_idx" ON "agent_runs" USING btree ("workspaceId","status");--> statement-breakpoint
CREATE INDEX "agent_runs_chat_idx" ON "agent_runs" USING btree ("chatId");