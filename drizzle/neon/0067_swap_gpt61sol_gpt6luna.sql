-- The Sol slot moves from GPT-6.1 Sol to GPT-6 Luna, still upstreamed to
-- Coarena (catalogue id gpt-6-luna, upstream gpt-6-luna). Remap chats that
-- had selected the Sol slot so they keep pointing at a live catalogue entry
-- instead of resolving to nothing and falling through the model chain.
UPDATE "chats" SET "model" = 'gpt-6-luna' WHERE "model" = 'gpt-6.1-sol';
