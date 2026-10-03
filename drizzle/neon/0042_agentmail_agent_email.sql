ALTER TABLE "agent_emails" ALTER COLUMN "fromAgentId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_emails" ADD COLUMN IF NOT EXISTS "direction" varchar(16) DEFAULT 'outbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_emails" ADD COLUMN IF NOT EXISTS "fromAddress" varchar(200);--> statement-breakpoint
ALTER TABLE "agent_emails" ADD COLUMN IF NOT EXISTS "toAddress" varchar(200);--> statement-breakpoint
ALTER TABLE "agent_emails" ADD COLUMN IF NOT EXISTS "messageId" varchar(200);--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "agentmailInboxId" varchar(120);--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "agentmailAddress" varchar(200);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_emails_message_id_unique" ON "agent_emails" USING btree ("messageId");
