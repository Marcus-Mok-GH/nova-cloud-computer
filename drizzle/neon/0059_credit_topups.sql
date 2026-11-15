-- One-time credit bundle purchases (see shared/creditTopUps.ts for the ladder).
-- Purchased credits are tracked per purchase rather than merged into the
-- subscription's monthly ledger, so a lapsed subscription cannot appear to hold
-- bought credits. The unique index on the provider payment id is the
-- idempotency guard: a replayed webhook conflicts instead of granting twice.
CREATE TABLE IF NOT EXISTS "credit_purchases" (
  "id" serial PRIMARY KEY,
  "ownerId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "providerPaymentId" varchar(120) NOT NULL,
  "productId" varchar(40) NOT NULL,
  "priceCents" integer NOT NULL,
  "currency" varchar(8) NOT NULL,
  "credits" integer NOT NULL,
  "remainingCredits" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_purchases_payment_unique" ON "credit_purchases" ("providerPaymentId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_purchases_owner_idx" ON "credit_purchases" ("ownerId", "createdAt");
