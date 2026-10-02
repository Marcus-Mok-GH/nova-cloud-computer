ALTER TABLE "workspace_settings" ADD COLUMN "personalisationEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "personalisationProfile" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "personalisationTone" varchar(60);--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "personalisationDetail" varchar(20);--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "personalisationProactiveness" varchar(20);--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "personalisationExpertise" varchar(20);