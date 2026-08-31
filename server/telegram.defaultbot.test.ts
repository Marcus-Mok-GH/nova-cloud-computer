import { beforeEach, describe, expect, it, vi } from "vitest";
import { telegramBotSettings, workspaces } from "../drizzle/schema";

process.env.DATABASE_URL = "postgres://test";
process.env.DEFAULT_TELEGRAM_BOT_TOKEN = "987654:default-bot-token";

let stored: Record<string, unknown> | undefined;
let workspaceResult: Record<string, unknown>[] = [];
let telegramRows: Record<string, unknown>[] = [];

const workspace = { id: 9, ownerId: 7, name: "Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
const otherWorkspace = { id: 10, ownerId: 8, name: "Other Nova", description: null, createdAt: new Date(), updatedAt: new Date() };

function query(rows: Record<string, unknown>[]) {
  let current = rows;
  const q = Object.assign(Promise.resolve(current), {
    where: () => query(current),
    orderBy: () => query(current),
    limit: async () => current,
  });
  return q;
}

const fakeDb = {
  select: vi.fn(() => ({
    from: (table: unknown) => {
      if (table === workspaces) return query(workspaceResult);
      if (table === telegramBotSettings) return query([...telegramRows, ...(stored ? [stored] : [])]);
      return query([]);
    },
  })),
  insert: vi.fn(() => ({
    values: (values: Record<string, unknown>) => {
      stored = { id: 1, ...values, createdAt: new Date(), updatedAt: new Date() };
      return {
        onConflictDoNothing: () => ({ returning: async () => [stored] }),
      };
    },
  })),
  update: vi.fn(() => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({ returning: async () => {
        if (stored) stored = { ...stored, ...values };
        return stored ? [stored] : [];
      } }),
    }),
  })),
  delete: vi.fn(),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./telegram", () => ({ getTelegramWebhookInfo: vi.fn(async () => ({ url: "", linked: false, pendingUpdateCount: 0 })) }));
vi.mock("./modelSecrets", () => ({
  encryptModelApiKey: vi.fn(), decryptModelApiKey: vi.fn(),
  encryptPrivateCredential: vi.fn((token: string) => `encrypted:${token}`),
  decryptPrivateCredential: vi.fn((cipherText: string) => cipherText.replace(/^encrypted:/, "")),
}));

const { findWorkspaceOwnerByTelegramToken, getTelegramCredentialsForUser, updateTelegramChatForUser } = await import("./db");

describe("Default Telegram bot fallback", () => {
  beforeEach(() => {
    stored = undefined;
    telegramRows = [];
    workspaceResult = [workspace];
    vi.clearAllMocks();
  });

  it("exposes the server-wide default bot as credentials before anything is saved", async () => {
    await expect(getTelegramCredentialsForUser(7)).resolves.toMatchObject({ token: "987654:default-bot-token", chatId: null });
    expect(stored?.encryptedBotToken).toBe("encrypted:987654:default-bot-token");
    await getTelegramCredentialsForUser(7);
    expect(fakeDb.insert.mock.calls.length).toBe(1);
  });

  it("auto-links a chat for the default bot by materializing and updating its settings row", async () => {
    const result = await updateTelegramChatForUser(7, "-10042");
    expect(result).toMatchObject({ configured: true, chatId: "-10042", webhook: { linked: false } });
    expect(stored?.chatId).toBe("-10042");
    await expect(getTelegramCredentialsForUser(7)).resolves.toMatchObject({ token: "987654:default-bot-token", chatId: "-10042" });
  });

  it("routes default-bot webhook updates to the workspace whose settings row owns the chatId", async () => {
    telegramRows = [{ id: 1, workspaceId: workspace.id, encryptedBotToken: "encrypted:987654:default-bot-token", chatId: "-10042", botUsername: null, botDisplayName: null, createdAt: new Date(), updatedAt: new Date() }];
    await expect(findWorkspaceOwnerByTelegramToken("987654:default-bot-token", "-10042")).resolves.toBe(7);
  });

  it("returns null for an unlinked chat instead of falling back to the oldest workspace", async () => {
    await expect(findWorkspaceOwnerByTelegramToken("987654:default-bot-token", "-99999")).resolves.toBeNull();
    await expect(findWorkspaceOwnerByTelegramToken("987654:default-bot-token")).resolves.toBeNull();
  });

  it("still routes a saved custom bot to its own workspace owner", async () => {
    telegramRows = [{ id: 2, workspaceId: otherWorkspace.id, encryptedBotToken: "encrypted:123456:custom-token", chatId: "42", botUsername: "custom_bot", botDisplayName: "Custom", createdAt: new Date(), updatedAt: new Date() }];
    workspaceResult = [otherWorkspace];
    await expect(findWorkspaceOwnerByTelegramToken("123456:custom-token")).resolves.toBe(8);
  });

  it("routes by chatId, never failing back to the oldest workspace for a foreign default-token row", async () => {
    // The sender owns chatId "-42" (other workspace); routing must resolve to
    // that settings row's workspace owner, not the oldest workspace (id 9/owner 7).
    telegramRows = [{ id: 3, workspaceId: otherWorkspace.id, encryptedBotToken: "encrypted:987654:default-bot-token", chatId: "-42", botUsername: null, botDisplayName: null, createdAt: new Date(), updatedAt: new Date() }];
    workspaceResult = [otherWorkspace];
    await expect(findWorkspaceOwnerByTelegramToken("987654:default-bot-token", "-42")).resolves.toBe(8);
  });
});