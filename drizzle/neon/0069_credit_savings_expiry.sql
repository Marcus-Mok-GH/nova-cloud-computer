-- Daily savings expire at a 00:00 UTC boundary.
--
-- The retired monthly pool set the precedent: its credits expired at a
-- PERIOD boundary (a month), not at an arbitrary offset from when they were
-- bought. The daily pool's period boundary is 00:00 UTC.
--
-- The daily allowance is rewritten at UTC midnight, so the balance that holds
-- the credits set aside from it has to say when it dies too. A balance that
-- expired at the SAME midnight it was funded would be a trap: the credits
-- would leave the day's allowance and vanish before they could be spent,
-- while the allowance refilled to its full size anyway. So a balance rolls
-- over the reset it was funded against and then expires at the next
-- 00:00 UTC boundary after that. A balance funded on day D is spendable on
-- day D and on day D+1, and is gone at 00:00 UTC on day D+2.
--
-- The expiry lives on the SAME row as the balance, so the cap is still read
-- from one lockable row and stays exact when two set-asides race.
--
-- `paid_credit_savings` deliberately gets NO expiry column: bought credits
-- never expire, so that balance never does either.
--
-- Existing rows were funded under the old rule (the balance rolled over
-- indefinitely), so they are given the same expiry a deposit made today
-- would get: they survive this midnight and expire at the boundary after it.
-- Adding the column with its DEFAULT and NOT NULL in one statement gives the
-- existing rows that same expiry and closes the window in which the column
-- would otherwise be nullable.
ALTER TABLE "daily_credit_savings" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp with time zone DEFAULT ((date_trunc('day', (now() AT TIME ZONE 'utc')) + interval '2 days') AT TIME ZONE 'utc') NOT NULL;
--> statement-breakpoint
UPDATE "daily_credit_savings" SET "expiresAt" = ((date_trunc('day', (now() AT TIME ZONE 'utc')) + interval '2 days') AT TIME ZONE 'utc') WHERE "expiresAt" IS NULL;
--> statement-breakpoint
ALTER TABLE "daily_credit_savings" ALTER COLUMN "expiresAt" SET DEFAULT ((date_trunc('day', (now() AT TIME ZONE 'utc')) + interval '2 days') AT TIME ZONE 'utc');
--> statement-breakpoint
ALTER TABLE "daily_credit_savings" ALTER COLUMN "expiresAt" SET NOT NULL;
