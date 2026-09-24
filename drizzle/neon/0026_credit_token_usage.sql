ALTER TABLE "daily_credits" ADD COLUMN "inputTokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_credits" ADD COLUMN "outputTokens" integer DEFAULT 0 NOT NULL;
