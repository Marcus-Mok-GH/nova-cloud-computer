-- The former Claude Sonnet 5.5 slot now serves OpenAI's GPT-6.1 Sol
-- (catalogue id gpt-6.1-sol, upstream gpt-6-1-sol), still upstreamed to
-- Coarena. Remap chats that had selected the Claude slot so they keep
-- pointing at a live catalogue entry instead of resolving to nothing.
UPDATE "chats" SET "model" = 'gpt-6.1-sol' WHERE "model" = 'claude-sonnet-5.5';
