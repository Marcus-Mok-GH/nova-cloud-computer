-- Goodwill credits for the storage-outage inconvenience.
--
-- Nova's database hit its provider quota, so every database-backed surface was
-- unavailable while the limits switched over. To make up for the disruption,
-- every EXISTING account is credited 1,000 credits.
--
-- The credits go into the bought-credit ledger (`credit_purchases`), which is
-- the only credit bucket that does not expire: the daily allowance is
-- rewritten at UTC midnight, so a gift placed there would evaporate. A
-- bought-credit row is spent only after the daily allowance runs out, and it
-- never expires.
--
-- Each account gets ONE row, keyed by a payment id derived from its owner id,
-- so the grant can be re-applied without ever granting twice. The unique
-- index on `providerPaymentId` is the idempotency guard; the insert conflicts
-- with itself rather than adding a second row.
--
-- The grant is a FIXED set of accounts: those that existed before Nova came
-- back (2026-12-01T00:00:00Z). Without that cutoff the same outage would
-- compensate a different set of accounts depending on when the migration ran,
-- and re-running it would reach accounts created after the disruption - which
-- never experienced it.
--
-- The values here mirror shared/outageCompensation.ts, which the server and
-- the client read; server/db/creditTopUps.test.ts asserts the two agree.
DO $$ BEGIN
  INSERT INTO "credit_purchases"
    ("ownerId", "providerPaymentId", "productId", "priceCents", "currency", "credits", "remainingCredits", "createdAt", "updatedAt")
  SELECT
    u."id",
    'outage-compensation-2026-11:' || u."id"::text,
    'outage-compensation',
    0,
    'sgd',
    1000,
    1000,
    now(),
    now()
  FROM "users" u
  WHERE u."createdAt" < '2026-12-01T00:00:00.000Z'
  ON CONFLICT ("providerPaymentId") DO NOTHING;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;
