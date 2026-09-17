/** One-off live E2E: run the real workspace agent against production —
 *  scaffold a React project template and publish it live. Not committed. */
import { readFileSync } from "node:fs";

// Load production env first — module imports read process.env at import time.
for (const line of readFileSync(".env.production", "utf8").split("\n")) {
  const match = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (match) {
    let value = match[2];
    if (/^".*"$/s.test(value) || /^'.*'$/s.test(value)) value = value.slice(1, -1);
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

const { getDb, getTelegramCredentialsForUser } = await import("./server/db");
const { users } = await import("./drizzle/schema");
const { createChatForUser } = await import("./server/db");
const { runWorkspaceAgent } = await import("./server/workspaceAgent");

const db = await getDb();
if (!db) throw new Error("no db");
const allUsers = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users);
console.log("users:", JSON.stringify(allUsers, null, 1));

// Pick the owner: the user with a linked Telegram chat, else the non-admin account.
let ownerId: number | undefined;
for (const candidate of allUsers) {
  const credentials = await getTelegramCredentialsForUser(candidate.id);
  if (credentials?.chatId) { ownerId = candidate.id; break; }
}
if (ownerId === undefined) {
  const nonAdmin = allUsers.find(u => u.role !== "admin");
  ownerId = nonAdmin?.id ?? allUsers[0]?.id;
}
console.log("owner:", ownerId);
if (ownerId === undefined) throw new Error("no owner found");

const chat = await createChatForUser(ownerId, "React template E2E");
const prompt = "Make me a small React demo landing page called React Demo and publish it live.";
console.log("chat id:", chat.id, "— running agent…");

const started = Date.now();
const result = await runWorkspaceAgent(ownerId, chat.id, prompt, {
  onChunk: (chunk: string) => process.stdout.write(chunk),
  onEvent: (event: any) => {
    if (event.type === "tool")
      console.log(`\n[tool ${event.tool.state}] ${event.tool.name}(${JSON.stringify(event.tool.args)})`);
  },
});
console.log(`\n\n=== done in ${Math.round((Date.now() - started) / 1000)}s ===`);
console.log("actions:", JSON.stringify(result.actions, null, 1));
console.log("reply:", result.message.content);
process.exit(0);
