/**
 * Applies the repository's migration set to the database named by
 * `DATABASE_URL` (or `DATABASE_URL_UNPOOLED`) and exits. This is the
 * documented way to give a fresh standby its schema:
 *
 *   DATABASE_URL=$BACKUP2_DATABASE_URL pnpm exec tsx scripts/apply-schema.ts
 *
 * The server runs the same code path at boot (see `ensureDatabaseSchema`),
 * but a standby that is never queried never boots the server against it -
 * so provisioners run this once after creating the database.
 */
import { ensureDatabaseSchema } from "../server/migrate";

ensureDatabaseSchema()
  .then(ok => {
    console.log(ok ? "Schema applied." : "Schema not applied (see log above).");
    process.exit(ok ? 0 : 1);
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
