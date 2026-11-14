-- The onboarding country question: which country the user signed up from,
-- stored as an ISO 3166-1 alpha-2 code. shared/countries.ts maps it to the
-- interface language the app switches to on signup.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingCountry" varchar(2);
