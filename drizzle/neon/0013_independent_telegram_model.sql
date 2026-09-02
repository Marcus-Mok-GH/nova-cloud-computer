ALTER TABLE "telegram_bot_settings" ADD COLUMN IF NOT EXISTS "modelProvider" text NOT NULL DEFAULT 'nvidia-nim';
ALTER TABLE "telegram_bot_settings" ADD COLUMN IF NOT EXISTS "modelId" varchar(240) NOT NULL DEFAULT 'z-ai/glm-5.2';
ALTER TABLE "telegram_bot_settings" ADD COLUMN IF NOT EXISTS "customModelId" integer;
CREATE INDEX IF NOT EXISTS "telegram_bot_settings_custom_model_idx" ON "telegram_bot_settings" ("customModelId");
