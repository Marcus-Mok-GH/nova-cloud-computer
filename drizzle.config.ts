import { defineConfig } from "drizzle-kit";

// Prefer the direct (unpooled) Neon endpoint when available: drizzle-kit holds a
// dedicated connection while generating/applying migrations, and Neon's pooled
// endpoint can reject or misroute the DDL session.
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to run Drizzle commands");

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/neon",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
});
