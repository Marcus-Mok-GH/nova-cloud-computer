ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" varchar(64);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users" ("username");
