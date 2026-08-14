import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
console.log(process.env.DATABASE_URL?.startsWith("postgres") ? "DATABASE_URL_FORMAT_OK" : "DATABASE_URL_FORMAT_INVALID");

try {
  await client.connect();
  const result = await client.query("select 1 as connected");
  console.log(result.rows[0]?.connected === 1 ? "NEON_CONNECTION_OK" : "NEON_CONNECTION_UNEXPECTED_RESULT");
  await client.end();
} catch (error) {
  console.error("NEON_CONNECTION_FAILED", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
