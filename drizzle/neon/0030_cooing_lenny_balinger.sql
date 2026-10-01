-- IF NOT EXISTS keeps this idempotent: environments that already added the
-- value out-of-band (journal drift) must still be able to record this
-- migration instead of failing every subsequent deploy build.
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'developer';