import { beforeEach, describe, expect, it, vi } from "vitest";
import { telegramBotSettings, workspaces } from "../drizzle/schema";

let stored: Record<string, unknown> | undefined;
const workspace = { id: 9, ownerId: 7, name: "Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
const otherWorkspace = { id: 10, ownerId: 8, name: "Other Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
let activeWorkspace = workspace;
const fakeDb = {
  select: vi.fn(() => ({
    from: (table: unknown) => ({
      where: () => ({ limit: async () => table === workspaces ? [activeWorkspace] : table === telegramBotSettings && stored?.workspaceId === activeWorkspace.id ? [stored] : [] }),
    }),
  })),
  insert: vi.fn(() => ({
    values: (values: Record<string, unknown>) => {
      stored = { id: 1, ...values, createdAt: new Date(), updatedAt: new Date() };
      return { onConflictDoUpdate: async () => undefined, onConflictDoNothing: async () => undefined, returning: async () => [stored] };
    },
  })),
  update: vi.fn(), delete: vi.fn(),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./modelSecrets", () => ({
  encryptModelApiKey: vi.fn(), decryptModelApiKey: vi.fn(),
  encryptPrivateCredential: vi.fn((token: string) => `encrypted:${token}`),
  decryptPrivateCredential: vi.fn((cipherText: string) => cipherText.replace(/^encrypted:/, "")),
}));

const { getTelegramCredentialsForUser, getTelegramSettingsForUser, saveTelegramSettingsForUser } = await import("./db");

describe("Telegram settings persistence", () => {
  beforeEach(() => { stored = undefined; activeWorkspace = workspace; process.env.DATABASE_URL = "postgres://test"; vi.clearAllMocks(); });

  it("stores the BotFather token encrypted and returns only safe metadata to the settings client", async () => {
    const botToken = "123456:private-bot-token";
    const safe = await saveTelegramSettingsForUser(7, { botToken, chatId: "-1001", botUsername: "nova_test_bot", botDisplayName: "Nova" });
    expect(stored?.encryptedBotToken).toBe(`encrypted:${botToken}`);
    expect(JSON.stringify(safe)).not.toContain(botToken);
    expect(safe).toEqual({ configured: true, chatId: "-1001", botUsername: "nova_test_bot", botDisplayName: "Nova" });
    await expect(getTelegramCredentialsForUser(7)).resolves.toMatchObject({ token: botToken, chatId: "-1001" });
    await expect(getTelegramSettingsForUser(7)).resolves.not.toHaveProperty("encryptedBotToken");
    activeWorkspace = otherWorkspace;
    await expect(getTelegramCredentialsForUser(8)).resolves.toBeUndefined();
    await expect(getTelegramSettingsForUser(8)).resolves.toEqual({ configured: false, chatId: null, botUsername: null, botDisplayName: null });
  });
});
