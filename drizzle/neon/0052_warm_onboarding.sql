ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingSource" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingUseCase" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingExperience" varchar(40);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" timestamp with time zone;
