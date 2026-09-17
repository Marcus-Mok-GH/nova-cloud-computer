import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.production", "utf8").split("\n")) {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) {
    let v = m[2]; if (/^".*"$/s.test(v)) v = v.slice(1, -1); process.env[m[1]] = v;
  }
}
const { getDb } = await import("./server/db");
const { siteDeployments } = await import("./drizzle/schema");
const { desc } = await import("drizzle-orm");
const db = await getDb();
const rows = await db.select().from(siteDeployments).orderBy(desc(siteDeployments.id)).limit(3);
console.log(JSON.stringify(rows, null, 1));
process.exit(0);
