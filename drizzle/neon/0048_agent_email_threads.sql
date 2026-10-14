ALTER TABLE "agent_emails" ADD COLUMN IF NOT EXISTS "threadId" varchar(200);--> statement-breakpoint
ALTER TABLE "agent_emails" ADD COLUMN IF NOT EXISTS "chatId" varchar(24);--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_emails" ADD CONSTRAINT "agent_emails_chatId_chats_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_emails_thread_idx" ON "agent_emails" USING btree ("threadId");
