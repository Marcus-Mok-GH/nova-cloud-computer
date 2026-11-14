-- The Sonnet 4.6 picker slot now serves DeepSeek V4.1 Flash (see
-- shared/models.ts). Remap chats that had it selected so they keep pointing
-- at the slot's new model instead of silently resolving to no catalogue
-- entry and falling through to the built-in chain.
UPDATE "chats" SET "model" = 'deepseek-v4.1-flash' WHERE "model" = 'claude-sonnet-4.6';
