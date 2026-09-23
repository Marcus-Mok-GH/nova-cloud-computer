CREATE TABLE "daily_credits" (
  "id" serial PRIMARY KEY NOT NULL,
  "ownerId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "creditDay" varchar(10) NOT NULL,
  "region" varchar(32) DEFAULT 'global' NOT NULL,
  "allocatedCredits" integer NOT NULL,
  "usedCredits" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "daily_credits_owner_day_unique" ON "daily_credits" USING btree ("ownerId", "creditDay");--> statement-breakpoint
CREATE INDEX "daily_credits_owner_day_idx" ON "daily_credits" USING btree ("ownerId", "creditDay");
