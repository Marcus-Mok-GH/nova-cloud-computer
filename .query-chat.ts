import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.production", "utf8").split("\n")) {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) {
    let v = m[2]; if (/^".*"$/s.test(v)) v = v.slice(1, -1); process.env[m[1]] = v;
  }
}
const { getDb } = await import("./server/db");
const { chatMessages, chats, agentActions } = await import("./drizzle/schema");
const { desc, eq } = await import("drizzle-orm");
const db = await getDb();
const [chat] = await db.select().from(chats).orderBy(desc(chats.id)).limit(1);
console.log("latest chat:", JSON.stringify(chat));
const msgs = await db.select().from(chatMessages).where(eq(chatMessages.chatId, chat.id)).orderBy(chatMessages.id);
for (const m of msgs) {
  const c = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
  console.log(`\n[${m.role}] ${c}`);
}
const acts = await db.select().from(agentActions).where(eq(agentActions.workspaceId, chat.workspaceId)).orderBy(desc(agentActions.id)).limit(4);
console.log("\nrecent actions:", JSON.stringify(acts.map(a => ({ kind: a.kind, status: a.status, detail: a.detail })), null, 1));
process.exit(0);
