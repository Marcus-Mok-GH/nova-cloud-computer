DO $$ BEGIN CREATE TYPE "public"."agent_approval_status" AS ENUM('pending', 'executed', 'denied', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"ownerId" integer NOT NULL,
	"agentId" integer NOT NULL,
	"chatId" varchar(24),
	"action" varchar(32) NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "agent_approval_status" DEFAULT 'pending' NOT NULL,
	"resultSummary" text,
	"decidedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"fromAgentId" integer NOT NULL,
	"toAgentId" integer,
	"subject" varchar(240) NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"role" varchar(120),
	"instructions" text,
	"emailAlias" varchar(160) NOT NULL,
	"phoneHandle" varchar(40) NOT NULL,
	"walletBudgetCredits" integer DEFAULT 500 NOT NULL,
	"walletSpentCredits" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"chatId" varchar(24) NOT NULL,
	"agentId" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "kind" varchar(16) DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "agentId" integer;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "teamGoal" text;--> statement-breakpoint
ALTER TABLE "conversation_memories" ADD COLUMN IF NOT EXISTS "agentId" integer;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_agentId_agent_profiles_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_chatId_chats_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_emails" ADD CONSTRAINT "agent_emails_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_emails" ADD CONSTRAINT "agent_emails_fromAgentId_agent_profiles_id_fk" FOREIGN KEY ("fromAgentId") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_emails" ADD CONSTRAINT "agent_emails_toAgentId_agent_profiles_id_fk" FOREIGN KEY ("toAgentId") REFERENCES "public"."agent_profiles"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "chat_agents" ADD CONSTRAINT "chat_agents_chatId_chats_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "chat_agents" ADD CONSTRAINT "chat_agents_agentId_agent_profiles_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_approvals_owner_status_idx" ON "agent_approvals" USING btree ("ownerId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_approvals_agent_status_idx" ON "agent_approvals" USING btree ("agentId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_emails_workspace_created_idx" ON "agent_emails" USING btree ("workspaceId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_profiles_workspace_name_unique" ON "agent_profiles" USING btree ("workspaceId","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_profiles_workspace_alias_unique" ON "agent_profiles" USING btree ("workspaceId","emailAlias");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_agents_chat_agent_unique" ON "chat_agents" USING btree ("chatId","agentId");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "chats" ADD CONSTRAINT "chats_agentId_agent_profiles_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent_profiles"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "conversation_memories" ADD CONSTRAINT "conversation_memories_agentId_agent_profiles_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
