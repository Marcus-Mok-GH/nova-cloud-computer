ALTER TYPE "user_automation_frequency" ADD VALUE IF NOT EXISTS 'custom';--> statement-breakpoint
ALTER TABLE "user_automations" ADD COLUMN "scheduleTimezone" varchar(80) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_automations" ADD COLUMN "executionPrompt" text;--> statement-breakpoint
ALTER TABLE "user_automations" ADD COLUMN "args" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_automations" ADD COLUMN "definition" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "user_automations" SET "executionPrompt" = "instructions" WHERE "executionPrompt" IS NULL;--> statement-breakpoint
ALTER TABLE "user_automations" ALTER COLUMN "executionPrompt" SET NOT NULL;
