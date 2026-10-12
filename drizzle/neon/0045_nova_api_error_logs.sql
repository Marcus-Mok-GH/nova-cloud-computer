CREATE TABLE IF NOT EXISTS "nova_api_error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"endpoint" varchar(240) DEFAULT '/api/v1/chat/completions' NOT NULL,
	"method" varchar(16) DEFAULT 'POST' NOT NULL,
	"modelId" varchar(240) DEFAULT 'nova-pro' NOT NULL,
	"statusCode" integer NOT NULL,
	"errorKind" varchar(64),
	"errorCode" varchar(64),
	"errorMessage" varchar(1200) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "nova_api_error_logs" ADD CONSTRAINT "nova_api_error_logs_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nova_api_error_logs_created_idx" ON "nova_api_error_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nova_api_error_logs_owner_created_idx" ON "nova_api_error_logs" USING btree ("ownerId","createdAt");
