ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "emailThreadId" varchar(200);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chats_agent_email_thread_unique" ON "chats" USING btree ("workspaceId","agentId","emailThreadId");
