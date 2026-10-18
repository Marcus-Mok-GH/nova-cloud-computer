-- The developer rank is pinned to one address. Promote the existing account
-- now so it takes effect without waiting for the owner to sign in again.
--
-- drizzle-kit applies the whole pending chain in a single transaction, and
-- PostgreSQL refuses to use an enum value added earlier in that same
-- transaction (55P04 "unsafe use of new value"); on a fresh database 'developer'
-- only entered "user_role" in 0030. Skip the eager write there - the runtime
-- auth path re-asserts the pinned rank on every authenticated request - while
-- databases where the value is long committed still apply the promotion.
DO $$ BEGIN
	UPDATE "users" SET "role" = 'developer', "updatedAt" = now() WHERE lower("email") = 'mokmarcus068@gmail.com';
EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
END $$;
