import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { chatMessages, chats, users, workspaceFiles, workspaces } from "../drizzle/schema";
import { getDb } from "./db";
import { getUserChatsForAdmin, getUserFileContentForAdmin, getUserFilesForAdmin } from "./admin";

// Real-database tests for the admin inspection data access. Skipped unless a
// database is configured and explicitly requested, matching the repo's
// workspace integration test pattern.
const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === "1";
const databaseIt = runDatabaseIntegration ? it : it.skip;

type Fixture = { userId: number; chatId: number; fileId: number };

async function createInspectionFixture(handle: string, fileContent: string): Promise<Fixture> {
  const db = await getDb();
  if (!db) throw new Error("Database integration requested without a database connection.");
  const marker = Date.now();
  const [user] = await db
    .insert(users)
    .values({
      openId: `admin-inspect-${handle}-${marker}`,
      name: `Inspection ${handle}`,
      email: `admin-inspect-${handle}-${marker}@example.com`,
      loginMethod: "test",
      role: "user",
    })
    .returning();
  const [workspace] = await db.insert(workspaces).values({ ownerId: user.id, name: `Inspection ${handle}` }).returning();
  const [chat] = await db.insert(chats).values({ workspaceId: workspace.id, title: `Chat of ${handle}` }).returning();
  await db.insert(chatMessages).values([
    { chatId: chat.id, role: "user" as const, content: `first message of ${handle}` },
    { chatId: chat.id, role: "assistant" as const, content: `second message of ${handle}` },
  ]);
  const [file] = await db
    .insert(workspaceFiles)
    .values({ workspaceId: workspace.id, name: `${handle}.txt`, mimeType: "text/plain", content: fileContent })
    .returning();
  return { userId: user.id, chatId: chat.id, fileId: file.id };
}

async function deleteFixture(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database integration requested without a database connection.");
  // Deleting the user cascades to its workspace, chats, messages, and files.
  await db.delete(users).where(eq(users.id, userId));
}

describe("Nova admin inspection data access", () => {
  databaseIt("returns another account's chats, messages, and file content", async () => {
    const fullContent = `inspect-me ${"x".repeat(500)}`;
    const fixture = await createInspectionFixture("owner", fullContent);
    const other = await createInspectionFixture("other", "not for you");

    try {
      const inspectedChats = await getUserChatsForAdmin(fixture.userId);
      expect(inspectedChats).toHaveLength(1);
      expect(inspectedChats[0].title).toBe("Chat of owner");
      expect(inspectedChats[0].messages).toHaveLength(2);
      expect(inspectedChats[0].messages.map(message => message.content)).toEqual([
        "first message of owner",
        "second message of owner",
      ]);

      const inspectedFiles = await getUserFilesForAdmin(fixture.userId);
      expect(inspectedFiles).toHaveLength(1);
      expect(inspectedFiles[0]).toMatchObject({
        id: fixture.fileId,
        name: "owner.txt",
        mimeType: "text/plain",
        sizeBytes: fullContent.length,
      });
      expect(inspectedFiles[0].preview).toHaveLength(400);
      expect(inspectedFiles[0].preview.endsWith("inspect-me ")).toBe(false);

      const exactContent = await getUserFileContentForAdmin(fixture.userId, fixture.fileId);
      expect(exactContent).toMatchObject({ id: fixture.fileId, name: "owner.txt", content: fullContent });

      // Ownership guard: another account's file is never visible.
      expect(await getUserFileContentForAdmin(fixture.userId, other.fileId)).toBeUndefined();
      expect((await getUserFilesForAdmin(fixture.userId)).some(file => file.id === other.fileId)).toBe(false);
    } finally {
      await deleteFixture(fixture.userId);
      await deleteFixture(other.userId);
    }
  });
});
