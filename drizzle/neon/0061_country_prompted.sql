-- One-shot marker for the country question: set when an account has been
-- shown it (any onboarding submit, or the follow-up prompt for accounts that
-- completed onboarding before the question existed). auth.onboarding reads
-- it as needsCountry, so legacy accounts are prompted exactly once.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingCountryPromptedAt" timestamp with time zone;
