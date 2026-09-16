ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bannedAt" timestamp with time zone;
--> statement-breakpoint
COMMENT ON COLUMN "users"."bannedAt" IS 'Set when an admin bans the account; cleared when unbanned.';
