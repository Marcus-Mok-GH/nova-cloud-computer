-- Credit savings: two separate balances, one per credit source.
--
-- Nova has two credit sources with different refresh rules: the daily
-- allowance is rewritten at UTC midnight, while a purchased bundle never
-- expires. Mixing them in one balance would make it impossible to tell how
-- much of it survives the daily reset, so the two savings balances are
-- stored in their own tables and are never merged:
--
--   daily_credit_savings - credits moved out of the daily-refreshing allowance
--   paid_credit_savings  - credits moved out of a purchased bundle
--
-- Each balance is ONE row per account (unique on ownerId), not one row per
-- deposit. The daily balance is capped at a single day's allowance, and a
-- cap read as a cross-row aggregate is read from the statement SNAPSHOT, so
-- two concurrent set-asides would both see the same pre-race total, both
-- pass the guard, and the balance would end up over its cap. A single row
-- per account can be locked with `SELECT ... FOR UPDATE`, so the loser's
-- re-read sees the winner's committed total and refuses.
--
-- `credits` records how much was ever moved into the balance and
-- `remainingCredits` counts down as the savings are spent.
--
-- Note that `daily_credits` is deliberately left alone: the hot credit
-- ledger must keep working before this migration runs, so a set-aside is
-- recorded in the ledger's existing `usedCredits` counter instead of a new
-- column.
CREATE TABLE IF NOT EXISTS "daily_credit_savings" (
  "id" serial PRIMARY KEY,
  "ownerId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "credits" integer DEFAULT 0 NOT NULL,
  "remainingCredits" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_credit_savings_owner_key" ON "daily_credit_savings" ("ownerId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paid_credit_savings" (
  "id" serial PRIMARY KEY,
  "ownerId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "credits" integer DEFAULT 0 NOT NULL,
  "remainingCredits" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "paid_credit_savings_owner_key" ON "paid_credit_savings" ("ownerId");
