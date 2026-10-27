CREATE TABLE IF NOT EXISTS "monthly_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"creditMonth" varchar(7) NOT NULL,
	"allocatedCredits" integer NOT NULL,
	"usedCredits" integer DEFAULT 0 NOT NULL,
	"inputTokens" integer DEFAULT 0 NOT NULL,
	"outputTokens" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"plan" varchar(24) DEFAULT 'free' NOT NULL,
	"status" varchar(24) DEFAULT 'inactive' NOT NULL,
	"provider" varchar(24) DEFAULT 'whop' NOT NULL,
	"whopMembershipId" varchar(64),
	"whopUserId" varchar(64),
	"whopCheckoutConfigId" varchar(64),
	"currentPeriodStart" timestamp with time zone,
	"currentPeriodEnd" timestamp with time zone,
	"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whop_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"eventId" varchar(128) NOT NULL,
	"eventType" varchar(64),
	"membershipId" varchar(64),
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "model" varchar(64);--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "monthly_credits" ADD CONSTRAINT "monthly_credits_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "monthly_credits_owner_month_unique" ON "monthly_credits" USING btree ("ownerId","creditMonth");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monthly_credits_owner_month_idx" ON "monthly_credits" USING btree ("ownerId","creditMonth");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_subscriptions_owner_unique" ON "user_subscriptions" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_subscriptions_membership_idx" ON "user_subscriptions" USING btree ("whopMembershipId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whop_webhook_events_event_unique" ON "whop_webhook_events" USING btree ("eventId");