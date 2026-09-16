CREATE TABLE IF NOT EXISTS "telegram_update_log" (
    "updateId" bigint PRIMARY KEY,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
