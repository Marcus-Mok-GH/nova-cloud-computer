import { and, desc, eq, ilike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { agentMemories, type AgentMemory, type AgentMemoryKindValue } from "../drizzle/schema";

let db: ReturnType<typeof drizzle> | null = null;
async function getDb() { if (!db && process.env.DATABASE_URL) db = drizzle(neon(process.env.DATABASE_URL)); if (!db) throw new Error("The Nova database is unavailable."); return db; }

export const AGENT_MEMORY_KINDS: readonly AgentMemoryKindValue[] = ["fact", "preference", "instruction"];
export const RECENT_MEMORIES_LIMIT = 30;
export const MAX_MEMORY_CONTENT_CHARS = 2000;

export function isAgentMemoryKind(value: unknown): value is AgentMemoryKindValue {
  return typeof value === "string" && (AGENT_MEMORY_KINDS as readonly string[]).includes(value);
}

export async function saveAgentMemoryForUser(ownerId: number, input: { kind: AgentMemoryKindValue; content: string; chatId?: number | null }): Promise<AgentMemory> {
  const database = await getDb();
  const [created] = await database.insert(agentMemories).values({
    ownerId,
    kind: isAgentMemoryKind(input.kind) ? input.kind : "fact",
    content: input.content.slice(0, MAX_MEMORY_CONTENT_CHARS),
    chatId: input.chatId ?? null,
  }).returning();
  if (!created) throw new Error("Nova could not save that memory.");
  return created;
}

export async function listRecentAgentMemoriesForUser(ownerId: number, limit = RECENT_MEMORIES_LIMIT): Promise<AgentMemory[]> {
  const database = await getDb();
  return database.select().from(agentMemories).where(eq(agentMemories.ownerId, ownerId)).orderBy(desc(agentMemories.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
}

export async function searchAgentMemoriesForUser(ownerId: number, query: string, limit = 10): Promise<AgentMemory[]> {
  const database = await getDb();
  const needle = `%${query.slice(0, 200)}%`;
  return database.select().from(agentMemories).where(and(eq(agentMemories.ownerId, ownerId), ilike(agentMemories.content, needle))).orderBy(desc(agentMemories.createdAt)).limit(Math.min(Math.max(limit, 1), 50));
}

export async function deleteAgentMemoryForUser(ownerId: number, id: number): Promise<boolean> {
  const database = await getDb();
  const deleted = await database.delete(agentMemories).where(and(eq(agentMemories.id, id), eq(agentMemories.ownerId, ownerId))).returning();
  return deleted.length > 0;
}

/** Compact one-line-per-memory summary injected into the system prompt. */
export function memoriesPromptLine(memories: AgentMemory[]): string {
  if (!memories.length) return "";
  const lines = memories
    .slice(0, RECENT_MEMORIES_LIMIT)
    .map(m => `- [${m.kind}] ${m.content.replace(/\s+/g, " ").slice(0, 300)}`);
  return `Durable memories you saved about this user (most recent first, newest of ${memories.length}). These persist across every chat. Save new durable facts, preferences, and standing instructions with memory_save as they surface; recall older ones with memory_recall instead of guessing:\n${lines.join("\n")}`;
}
