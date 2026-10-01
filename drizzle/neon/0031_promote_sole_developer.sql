-- The developer rank is pinned to one address. Promote the existing account
-- now so it takes effect without waiting for the owner to sign in again.
UPDATE "users" SET "role" = 'developer', "updatedAt" = now() WHERE lower("email") = 'mokmarcus068@gmail.com';
