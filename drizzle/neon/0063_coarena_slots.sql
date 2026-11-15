-- Two picker slots changed model and provider (see shared/models.ts): the
-- Gemini slot follows Google's Gemini 4 Carbon, and the former Grok 4.1
-- slot now serves Claude Sonnet 5.5 - both upstreamed to Coarena. Remap
-- chats that had either selected so they keep pointing at a live catalogue
-- entry instead of resolving to nothing.
UPDATE "chats" SET "model" = 'gemini-4-carbon' WHERE "model" = 'gemini-3-pro';
--> statement-breakpoint
UPDATE "chats" SET "model" = 'claude-sonnet-5.5' WHERE "model" = 'grok-4.1';
