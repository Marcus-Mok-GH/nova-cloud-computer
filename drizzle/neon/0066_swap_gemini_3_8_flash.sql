-- The Gemini slot moves from Gemini 4 Carbon to Gemini 3.8 Flash.
UPDATE "chats" SET "model" = 'gemini-3-8-flash' WHERE "model" = 'gemini-4-carbon';
