CREATE TABLE IF NOT EXISTS "workspace_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(1024) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workspace_skills" ADD CONSTRAINT "workspace_skills_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_skills_owner_name_unique" ON "workspace_skills" USING btree ("ownerId","name");
