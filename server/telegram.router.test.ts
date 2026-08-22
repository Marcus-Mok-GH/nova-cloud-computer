process.env.NOVA_PUBLIC_BASE_URL ??= "https://nova-cloud-computer-server-marcusmok.zocomputer.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

type TelegramConfig = { token: string; chatId: string | null; botUsername: string | null; botDisplayName: string | null };
const telegramConfigs = new Map<number, TelegramConfig>();
const validate = vi.fn(async () => ({ id: "1", username: "nova_test_bot", displayName: "Nova Test" }));
const discover = vi.fn(async () => "-10044");
const setWebhook = vi.fn(async () => ({ result: true }));
const getWebhookInfo = vi.fn(async () => ({ url: "https://nova-cloud-computer-server-marcusmok.zocomputer.io/api/telegram/webhook/123456:private-bot-token", has_custom_certificate: false, pending_update_count: 0 }));
const send = vi.fn(async () => ({ message_id: 77 }));

function safe(ownerId: number) {
  const config = telegramConfigs.get(ownerId);
  return config
    ? { configured: true as const, chatId: config.chatId, botUsername: config.botUsername, botDisplayName: config.botDisplayName, webhook: { linked: true, url: "https://nova-cloud-computer-server-marcusmok.zocomputer.io/api/telegram/webhook/123456:private-bot-token" } }
    : { configured: false as const, chatId: null, botUsername: null, botDisplayName: null, webhook: { linked: false, url: null } };
}

vi.mock("./db", () => ({
  getTelegramSettingsForUser: vi.fn(async (ownerId: number) => safe(ownerId)),
  saveTelegramSettingsForUser: vi.fn(async (ownerId: number, input: { botToken: string; chatId?: string | null; botUsername?: string | null; botDisplayName?: string | null }) => {
    telegramConfigs.set(ownerId, { token: input.botToken, chatId: input.chatId ?? null, botUsername: input.botUsername ?? null, botDisplayName: input.botDisplayName ?? null });
    return safe(ownerId);
  }),
  getTelegramCredentialsForUser: vi.fn(async (ownerId: number) => telegramConfigs.get(ownerId) ? { ...telegramConfigs.get(ownerId)! } : undefined),
  updateTelegramChatForUser: vi.fn(async (ownerId: number, chatId: string) => { const config = telegramConfigs.get(ownerId); if (config) telegramConfigs.set(ownerId, { ...config, chatId }); return safe(ownerId); }),
  deleteTelegramSettingsForUser: vi.fn(async (ownerId: number) => telegramConfigs.delete(ownerId)),
  createWorkspaceFolderForUser: vi.fn(), updateWorkspaceFolderForUser: vi.fn(), deleteWorkspaceFolderForUser: vi.fn(),
  createWorkspaceFileForUser: vi.fn(), updateWorkspaceFileForUser: vi.fn(), deleteWorkspaceFileForUser: vi.fn(),
  createChatForUser: vi.fn(), listChatMessagesForUser: vi.fn(), getWorkspaceComputer: vi.fn(),
  getOrCreateWorkspace: vi.fn(), getWorkspaceDashboard: vi.fn(), getWorkspaceModelSettingsForUser: vi.fn(), updateWorkspaceModelSettingsForUser: vi.fn(),
  createCustomModelForUser: vi.fn(), deleteCustomModelForUser: vi.fn(), createProjectForUser: vi.fn(), createTaskForUser: vi.fn(), deleteProjectForUser: vi.fn(), deleteTaskForUser: vi.fn(), getProjectForUser: vi.fn(), listProjectsForUser: vi.fn(), listTasksForUser: vi.fn(), updateProjectForUser: vi.fn(), updateTaskStatusForUser: vi.fn(),
}));
vi.mock("./telegram", () => ({ validateTelegramBotToken: validate, discoverTelegramChat: discover, sendTelegramMessage: send, setTelegramWebhook: setWebhook, getTelegramWebhookInfo: getWebhookInfo }));
vi.mock("./workspaceAgent", () => ({ runWorkspaceAgent: vi.fn() }));
const { appRouter } = await import("./routers");

function context(id: number): TrpcContext {
  return { user: { id, openId: String(id), name: null, email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("Telegram protected router", () => {
  beforeEach(() => { telegramConfigs.clear(); vi.clearAllMocks(); });

  it("validates and stores a token privately, exposing only safe metadata", async () => {
    const owner = appRouter.createCaller(context(1));
    const result = await owner.telegram.configure({ botToken: "123456:private-bot-token", chatId: "42" });
    expect(validate).toHaveBeenCalledWith("123456:private-bot-token");
    expect(result).toEqual({ success: true, chatId: "42", botUsername: "nova_test_bot" });
    expect(await owner.telegram.status()).toMatchObject({ configured: true, chatId: "42", botUsername: "nova_test_bot", webhook: { linked: true } });
  });

  it("scopes discovery, test delivery, and removal to the authenticated owner", async () => {
    const owner = appRouter.createCaller(context(1));
    const stranger = appRouter.createCaller(context(2));
    await owner.telegram.configure({ botToken: "123456:private-bot-token" });
    await expect(owner.telegram.discoverChat()).resolves.toMatchObject({ configured: true, chatId: "-10044" });
    await expect(owner.telegram.sendTest({ text: "Hello" })).resolves.toEqual({ success: true, messageId: 77 });
    expect(send).toHaveBeenCalledWith("123456:private-bot-token", "-10044", "Hello");
    expect(await stranger.telegram.status()).toMatchObject({ configured: false });
    await expect(stranger.telegram.sendTest({ text: "Nope" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(owner.telegram.remove()).resolves.toEqual({ success: true });
    await expect(owner.telegram.status()).resolves.toMatchObject({ configured: false });
  });
});
