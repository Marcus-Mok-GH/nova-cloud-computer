import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * Copies the committed Drizzle migrations next to the bundled server output.
 *
 * `server/migrate.ts` applies pending migrations at boot so a missing table can
 * never crash the first request. It looks for the migrations under
 * `dist/server/drizzle`, which lets both the Vercel function (whose
 * `includeFiles` only ships `dist/server/**`) and a self-hosted `pnpm start`
 * find them without depending on where the repository is checked out.
 */
const source = "drizzle/neon";
const destination = "dist/server/drizzle";

if (!existsSync(source)) {
  console.error(`[migrations] ${source} is missing; refusing to build a server without migrations.`);
  process.exit(1);
}

await rm(destination, { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`[migrations] copied ${source} -> ${destination}`);
