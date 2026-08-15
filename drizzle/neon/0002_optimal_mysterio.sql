CREATE TABLE IF NOT EXISTS "telegram_bot_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"encryptedBotToken" text NOT NULL,
	"chatId" varchar(64),
	"botUsername" varchar(128),
	"botDisplayName" varchar(256),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_bot_settings_workspace_unique" ON "telegram_bot_settings" USING btree ("workspaceId");
