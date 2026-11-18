-- Daily image-generation allowance for the built-in generate_image agent tool.
-- Distinct from `daily_credits`: an image costs a whole generation slot, not
-- token credits, so spending one must never touch the chat balance. The unique
-- (ownerId, quotaDay) index is the atomic claim's conflict target, so two
-- concurrent calls cannot both pass the cap.
CREATE TABLE IF NOT EXISTS "image_generation_quotas" (
  "id" serial PRIMARY KEY,
  "ownerId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "quotaDay" varchar(10) NOT NULL,
  "usedImages" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "image_generation_quotas_owner_day_unique" ON "image_generation_quotas" ("ownerId", "quotaDay");
