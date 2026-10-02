CREATE TABLE IF NOT EXISTS "priority_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"purchasedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "priority_purchases" ADD CONSTRAINT "priority_purchases_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "priority_purchases_owner_unique" ON "priority_purchases" USING btree ("ownerId");--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('public.billing_subscriptions') IS NOT NULL THEN
    INSERT INTO "priority_purchases" ("ownerId", "purchasedAt")
    SELECT "ownerId", COALESCE("updatedAt", now()) FROM "billing_subscriptions" WHERE "plan" = 'priority'
    ON CONFLICT ("ownerId") DO NOTHING;
  END IF;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;
