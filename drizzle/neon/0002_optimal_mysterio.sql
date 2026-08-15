CREATE TABLE IF NOT EXISTS "telegram_bot_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"encryptedBotToken" text NOT NULL,
	"chatId" varchar(64),
	"botUsername" varchar(128),
	"botDisplayName" varchar(256),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_bot_settings_workspaceId_workspaces_id_fk') THEN
    ALTER TABLE "telegram_bot_settings" ADD CONSTRAINT "telegram_bot_settings_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_bot_settings_workspace_unique" ON "telegram_bot_settings" USING btree ("workspaceId");
