import { beforeEach, describe, expect, it, vi } from "vitest";
import { codebuffSettings, workspaces } from "../drizzle/schema";

let stored: Record<string, unknown> | undefined;
const workspace = { id: 9, ownerId: 7, name: "Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
const otherWorkspace = { id: 10, ownerId: 8, name: "Other Nova", description: null, createdAt: new Date(), updatedAt: new Date() };
let activeWorkspace = workspace;
const fakeDb = {
  select: vi.fn(() => ({
    from: (table: unknown) => ({
      where: () => ({ limit: async () => table === workspaces ? [activeWorkspace] : table === codebuffSettings && stored?.workspaceId === activeWorkspace.id ? [stored] : [] }),
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
  encryptPrivateCredential: vi.fn((value: string) => `encrypted:${value}`),
  decryptPrivateCredential: vi.fn((value: string) => value.replace(/^encrypted:/, "")),
}));

const { getCodebuffCredentialsForUser, getCodebuffSettingsForUser, saveCodebuffSettingsForUser } = await import("./db");

describe("Codebuff settings persistence", () => {
  beforeEach(() => { stored = undefined; activeWorkspace = workspace; process.env.DATABASE_URL = "postgres://test"; vi.clearAllMocks(); });

  it("encrypts a Codebuff key, returns safe metadata only, and does not cross workspace boundaries", async () => {
    const apiKey = "cb_private_key_123456789";
    const safe = await saveCodebuffSettingsForUser(7, apiKey);
    expect(stored?.encryptedApiKey).toBe(`encrypted:${apiKey}`);
    expect(JSON.stringify(safe)).not.toContain(apiKey);
    expect(safe).toMatchObject({ configured: true });
    await expect(getCodebuffCredentialsForUser(7)).resolves.toEqual({ apiKey });
    await expect(getCodebuffSettingsForUser(7)).resolves.not.toHaveProperty("encryptedApiKey");
    activeWorkspace = otherWorkspace;
    await expect(getCodebuffCredentialsForUser(8)).resolves.toBeUndefined();
    await expect(getCodebuffSettingsForUser(8)).resolves.toEqual({ configured: false, updatedAt: null });
  });
});
