CREATE TABLE "priority_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"purchasedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "priority_purchases" ADD CONSTRAINT "priority_purchases_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "priority_purchases_owner_unique" ON "priority_purchases" USING btree ("ownerId");--> statement-breakpoint
INSERT INTO "priority_purchases" ("ownerId", "purchasedAt")
SELECT "ownerId", COALESCE("updatedAt", now()) FROM "billing_subscriptions" WHERE "plan" = 'priority'
ON CONFLICT ("ownerId") DO NOTHING;