import { createHash, createHmac } from "crypto";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { getDb } from "./db";
import { conversationMemories } from "../drizzle/schema";

/**
 * Conversation memory: every completed agent turn is appended to the chat's
 * memory record (Neon Postgres is the source of truth) and mirrored to S3
 * when object-storage credentials are configured. The agent recalls past
 * work through tools (search_memories / read_memory) instead of leaning on
 * the workspace file tree, and can write explicit standalone memories with
 * save_memory.
 */

const TITLE_LIMIT = 300;
const SUMMARY_LIMIT = 280;
const TAGS_LIMIT = 500; // matches the varchar(500) tags column

/**
 * Memory is scoped: the workspace's shared scope (`agentId IS NULL`, what the
 * default Nova assistant uses) plus each personal agent's own scope. An agent
 * reads its own memories *and* the shared ones, but only ever writes to its
 * own; the default assistant never sees agent-private memories.
 */
export type MemoryScope = { agentId?: number | null };

function readScopeCondition(scope?: MemoryScope) {
  const agentId = scope?.agentId ?? null;
  return agentId
    ? or(
        isNull(conversationMemories.agentId),
        eq(conversationMemories.agentId, agentId)
      )
    : isNull(conversationMemories.agentId);
}

function writeScopeCondition(scope?: MemoryScope) {
  const agentId = scope?.agentId ?? null;
  return agentId
    ? eq(conversationMemories.agentId, agentId)
    : isNull(conversationMemories.agentId);
}
// The DB row keeps a rolling window of the transcript; S3 (when configured)
// receives the same full text so nothing is lost.
const CONTENT_WINDOW = 24_000;

export type ConversationMemoryRecord = {
  id: number;
  chatId: string | null;
  kind: string;
  title: string;
  summary: string;
  tags: string | null;
  content: string;
  s3Uri: string | null;
  updatedAt: Date;
};

function clip(text: string, limit: number) {
  const trimmed = text.trim();
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit - 1)}…`
    : trimmed;
}

function toRecord(row: typeof conversationMemories.$inferSelect): ConversationMemoryRecord {
  return {
    id: row.id,
    chatId: row.chatId,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    tags: row.tags,
    content: row.content,
    s3Uri: row.s3Uri,
    updatedAt: row.updatedAt,
  };
}

/** Explicit standalone memory written by the agent (or future callers). */
export async function saveMemoryForUser(
  ownerId: number,
  input: {
    title: string;
    summary: string;
    content: string;
    tags?: string | null;
    chatId?: string | null;
    kind?: string;
    /** Owning agent for agent-private memories; omit for the shared scope. */
    agentId?: number | null;
  }
): Promise<ConversationMemoryRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const title = clip(input.title || "Untitled memory", TITLE_LIMIT);
  const summary = clip(input.summary || input.content, SUMMARY_LIMIT);
  // Explicit notes get the same window as conversation records: read_memory
  // feeds the full record back into the model, so an oversized note would
  // otherwise blow the context of the round that reads it.
  const content = input.content.length > CONTENT_WINDOW
    ? `${input.content.slice(0, CONTENT_WINDOW)}\n\n(content truncated)`
    : input.content;
  const inserted = await db
    .insert(conversationMemories)
    .values({
      ownerId,
      chatId: input.chatId ?? null,
      agentId: input.agentId ?? null,
      kind: input.kind ?? "note",
      title,
      summary,
      tags: clip(input.tags ?? "", TAGS_LIMIT) || null,
      content,
    })
    .returning();
  const record = toRecord(inserted[0]);
  void syncMemoryToS3(ownerId, record).catch(error =>
    console.error("[Memory] S3 sync failed:", error)
  );
  return record;
}

async function getChatMemory(
  ownerId: number,
  chatId: string,
  scope?: MemoryScope
): Promise<typeof conversationMemories.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(conversationMemories)
    .where(
      and(
        eq(conversationMemories.ownerId, ownerId),
        eq(conversationMemories.chatId, chatId),
        eq(conversationMemories.kind, "conversation"),
        writeScopeCondition(scope)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Appends one completed turn to the chat's conversation memory, creating the
 * record on the first turn. Never throws: a memory failure must not break
 * the chat run itself.
 */
export async function appendConversationTurn(
  ownerId: number,
  chatId: string,
  turn: { userText: string; assistantText: string },
  scope?: MemoryScope
): Promise<ConversationMemoryRecord | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const userText = turn.userText.trim();
    const assistantText = turn.assistantText.trim();
    if (!userText && !assistantText) return null;
    const existing = await getChatMemory(ownerId, chatId, scope);
    const turnBlock = `User: ${userText}\nNova: ${assistantText}`;
    const content = existing
      ? `${existing.content}\n\n---\n\n${turnBlock}`
      : turnBlock;
    const windowed =
      content.length > CONTENT_WINDOW
        ? `…(earlier turns archived)\n\n${content.slice(-CONTENT_WINDOW)}`
        : content;
    const title = existing
      ? existing.title
      : clip(userText || assistantText, TITLE_LIMIT);
    const summary = clip(assistantText || userText, SUMMARY_LIMIT);
    const rows = existing
      ? await db
          .update(conversationMemories)
          .set({ summary, content: windowed, updatedAt: new Date() })
          .where(eq(conversationMemories.id, existing.id))
          .returning()
      : await db
          .insert(conversationMemories)
          .values({
            ownerId,
            chatId,
            agentId: scope?.agentId ?? null,
            kind: "conversation",
            title,
            summary,
            content: windowed,
          })
          .returning();
    const record = toRecord(rows[0]);
    void syncMemoryToS3(ownerId, record).catch(error =>
      console.error("[Memory] S3 sync failed:", error)
    );
    return record;
  } catch (error) {
    console.error("[Memory] Failed to capture conversation turn:", error);
    return null;
  }
}

/** Owner-scoped recall: fuzzy text search, or the most recent memories with no query. */
export async function searchMemoriesForUser(
  ownerId: number,
  query?: string | null,
  limit = 8,
  scope?: MemoryScope
): Promise<ConversationMemoryRecord[]> {
  const db = await getDb();
  if (!db) return [];
  // Backslashes would corrupt the ILIKE pattern (Postgres treats them as
  // the LIKE escape character, and a trailing one is a hard error).
  const trimmed = (query ?? "").replace(/\\/g, " ").trim();
  const where = trimmed
    ? and(
        eq(conversationMemories.ownerId, ownerId),
        readScopeCondition(scope),
        or(
          ilike(conversationMemories.title, `%${trimmed}%`),
          ilike(conversationMemories.summary, `%${trimmed}%`),
          ilike(conversationMemories.tags, `%${trimmed}%`),
          ilike(conversationMemories.content, `%${trimmed}%`)
        )
      )
    : and(
        eq(conversationMemories.ownerId, ownerId),
        readScopeCondition(scope)
      );
  const rows = await db
    .select()
    .from(conversationMemories)
    .where(where)
    .orderBy(desc(conversationMemories.updatedAt))
    .limit(Math.max(1, Math.min(limit, 25)));
  return rows.map(toRecord);
}

export async function readMemoryForUser(
  ownerId: number,
  memoryId: number,
  scope?: MemoryScope
): Promise<ConversationMemoryRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(conversationMemories)
    .where(
      and(
        eq(conversationMemories.ownerId, ownerId),
        eq(conversationMemories.id, memoryId),
        readScopeCondition(scope)
      )
    )
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function deleteMemoryForUser(
  ownerId: number,
  memoryId: number,
  scope?: MemoryScope
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const deleted = await db
    .delete(conversationMemories)
    .where(
      and(
        eq(conversationMemories.ownerId, ownerId),
        eq(conversationMemories.id, memoryId),
        writeScopeCondition(scope)
      )
    )
    .returning({ id: conversationMemories.id });
  return deleted.length > 0;
}

/**
 * Clears every memory the owner has stored. With no scope this removes the
 * shared (default Nova) memories *and* every personal agent's private ones;
 * passing a scope narrows the wipe to just that agent. Returns the number of
 * records removed.
 */
export async function clearMemoriesForUser(
  ownerId: number,
  scope?: MemoryScope
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const deleted = await db
    .delete(conversationMemories)
    .where(
      and(
        eq(conversationMemories.ownerId, ownerId),
        scope ? writeScopeCondition(scope) : undefined
      )
    )
    .returning({ id: conversationMemories.id });
  return deleted.length;
}

/** Compact recall lines for the system prompt. */
export async function listRecentMemoriesForPrompt(
  ownerId: number,
  limit = 8,
  scope?: MemoryScope
): Promise<string> {
  const records = await searchMemoriesForUser(ownerId, null, limit, scope);
  if (!records.length) return "none yet";
  return records
    .map(
      record =>
        `${record.title} (memory id ${record.id}, updated ${record.updatedAt.toISOString().slice(0, 10)}): ${record.summary}`
    )
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* S3 mirror: active only when a bucket and credentials are configured. */
/* ------------------------------------------------------------------ */

function s3Config() {
  const bucket = (process.env.S3_MEMORY_BUCKET ?? "").trim();
  const region = (process.env.S3_MEMORY_REGION ?? "us-east-1").trim();
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return { bucket, region, accessKeyId, secretAccessKey };
}

function sha256Hex(data: string) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Builds the signed PUT request for one S3 object (AWS SigV4, no SDK
 * dependency, sized for the serverless bundle). Exported for testing.
 */
export function buildS3PutRequest(
  config: { bucket: string; region: string; accessKeyId: string; secretAccessKey: string },
  key: string,
  body: string,
  now: Date
): { url: string; headers: Record<string, string> } {
  const { bucket, region, accessKeyId, secretAccessKey } = config;
  const payloadHash = sha256Hex(body);
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "")
    .slice(0, 16); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    `/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");
  return {
    url: `https://${host}/${key}`,
    headers: {
      Host: host,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "Content-Type": "text/markdown",
    },
  };
}

/**
 * Uploads the memory to S3 (when configured) and records the object URI on
 * the row. The DB row stays the source of truth; the S3 copy is an
 * archival mirror.
 */
async function syncMemoryToS3(
  ownerId: number,
  record: ConversationMemoryRecord
): Promise<string | null> {
  const config = s3Config();
  if (!config) return null;
  const key = `memories/${ownerId}/${record.id}.md`;
  const body = `# ${record.title}\n\n${record.summary}\n\n${record.content}\n`;
  const request = buildS3PutRequest(config, key, body, new Date());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(request.url, {
      method: "PUT",
      headers: request.headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`S3 PUT failed: ${response.status} ${await response.text().catch(() => "")}`);
    const s3Uri = `s3://${config.bucket}/${key}`;
    const db = await getDb();
    if (db) {
      await db
        .update(conversationMemories)
        .set({ s3Uri })
        .where(eq(conversationMemories.id, record.id));
    }
    return s3Uri;
  } finally {
    clearTimeout(timeout);
  }
}
