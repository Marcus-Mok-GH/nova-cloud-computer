import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceSettings from "./WorkspaceSettings";

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, email: "test@example.com", name: "Test User" }, logout: vi.fn() }) }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { modelSettings: { useQuery: () => ({ data: { workspaceRules: null, customModels: [], activeProvider: "anthropic", activeCustomModelId: null, personalisationEnabled: false, personalisationProfile: null, personalisationTone: null, personalisationDetail: null, personalisationProactiveness: null, personalisationExpertise: null }, isLoading: false, isError: false, refetch: vi.fn() }) }, environmentVars: { useQuery: () => ({ data: [{ name: "STRIPE_API_KEY", value: "sk_live_123" }], isLoading: false, isError: false, refetch: vi.fn() }) }, setEnvironmentVars: { useMutation: () => mutation }, listMemories: { useQuery: () => ({ data: [], isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }) }, updateSettings: { useMutation: () => mutation }, factoryReset: { useMutation: () => mutation }, clearMemories: { useMutation: () => mutation }, deleteMemory: { useMutation: () => mutation }, dashboard: { invalidate: vi.fn() }, computer: { invalidate: vi.fn() } },
    chats: { create: { useMutation: () => mutation } },
    models: { createCustom: { useMutation: () => mutation }, deleteCustom: { useMutation: () => mutation }, testCustom: { useMutation: () => mutation } },
    ai: { status: { useQuery: () => ({ data: { model: "chat-large-latest" }, isLoading: false, isError: false, refetch: vi.fn() } ) } },
    telegram: { status: { useQuery: () => ({ data: { configured: true, chatId: "42", botUsername: "nova_test_bot", webhook: { linked: true } } }) }, modelSettings: { useQuery: () => ({ data: { modelId: "test", options: [] } }) }, updateModel: { useMutation: () => mutation }, configure: { useMutation: () => mutation }, discoverChat: { useMutation: () => mutation }, sendTest: { useMutation: () => mutation }, remove: { useMutation: () => mutation } },
    automations: { list: { useQuery: () => ({ data: [], isLoading: false, isError: false }) }, runs: { useQuery: () => ({ data: [], isLoading: false }) }, update: { useMutation: () => mutation }, runDue: { useMutation: () => mutation } },
    auth: { requestDeletionCode: { useMutation: () => mutation }, confirmDeleteAccount: { useMutation: () => mutation } },
    apiKeys: { list: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }) }, create: { useMutation: () => mutation }, rename: { useMutation: () => mutation }, revoke: { useMutation: () => mutation } },
    billing: { status: { useQuery: () => ({ data: { priority: false, armed: false, purchasedAt: null, activatedAt: null, expiresAt: null }, isLoading: false, isError: false, refetch: vi.fn() }) }, purchasePriority: { useMutation: () => mutation } },
    composio: { status: { useQuery: () => ({ data: { keyLength: 40, toolkits: { github: { configured: true, connected: true, status: "active", connectedAccountId: "acc_github" }, gmail: { configured: true, connected: false, status: "disconnected", connectedAccountId: null }, vercel: { configured: true, connected: false, status: "disconnected", connectedAccountId: null } } }, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }) }, connect: { useMutation: () => mutation }, disconnect: { useMutation: () => mutation } },
    codex: { status: { useQuery: () => ({ data: { configured: true, connected: false, pending: false, state: "disconnected", verificationUrl: null, userCode: null }, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }) }, connect: { useMutation: () => mutation }, disconnect: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { modelSettings: { invalidate: vi.fn() }, environmentVars: { invalidate: vi.fn() }, dashboard: { invalidate: vi.fn() }, listMemories: { invalidate: vi.fn() } }, telegram: { status: { invalidate: vi.fn() } }, automations: { list: { invalidate: vi.fn() }, runs: { invalidate: vi.fn() } }, composio: { status: { invalidate: vi.fn() } }, codex: { status: { invalidate: vi.fn() } }, billing: { status: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: "light",
    themeName: "daylight",
    toggleTheme: vi.fn(),
    switchable: true,
    setThemeName: vi.fn(),
    themes: [
      { id: "daylight", labelKey: "settings.theme.name.daylight", mode: "light", descriptionKey: "settings.theme.desc.daylight" },
      { id: "ocean", labelKey: "settings.theme.name.ocean", mode: "light", descriptionKey: "settings.theme.desc.ocean" },
      { id: "midnight", labelKey: "settings.theme.name.midnight", mode: "dark", descriptionKey: "settings.theme.desc.midnight" },
      { id: "deepsea", labelKey: "settings.theme.name.deepsea", mode: "dark", descriptionKey: "settings.theme.desc.deepsea" },
    ],
  }),
}));

describe("Workspace settings page", () => {
  it("renders workspace rules, Telegram connection, and natural-language automations", () => {
    const markup = renderToStaticMarkup(<WorkspaceSettings />);
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain("General");
    expect(markup).toContain("AI provider (BYOK)");
    expect(markup).toContain("Connections");
    expect(markup).toContain("OpenAI Codex");
    expect(markup).toContain("Automations");
    expect(markup).toContain("API keys");
    expect(markup).toContain("Billing");
    expect(markup).toContain("Priority requests");
    expect(markup).toContain("Buy 1 hour of priority");
    expect(markup).toContain("Account</button>");
    expect(markup).toContain("Workspace rules");
    expect(markup).toContain("Personalisation");
    expect(markup).toContain("Tune Nova to how you work");
    expect(markup).toContain("Personalisation mode");
    expect(markup).toContain("What Nova knows about you");
    expect(markup).toContain("Start guided setup");
    expect(markup).toContain("What Nova remembers");
    expect(markup).toContain("Stored memories");
    expect(markup).toContain("Nova has not stored any memories yet.");
    expect(markup).toContain("Clear all memory");
    expect(markup).toContain("Appearance");
    expect(markup).toContain("Daylight");
    expect(markup).toContain("Deep sea");
    expect(markup).toContain("How Nova should help");
    expect(markup).toContain("Factory reset workspace");
    expect(markup).toContain("Reset everything from scratch");
    expect(markup).toContain("Telegram Bot");
    // Telegram is connected in this mock, so the card flips to its disconnect form.
    expect(markup).toContain("Disconnect your Telegram account");
    expect(markup).toContain("Disconnect Telegram");
    expect(markup).toContain("you can connect again any time");
    expect(markup).not.toContain("Connect Telegram");
    expect(markup).toContain("Use your own AI provider");
    expect(markup).toContain("Nova built-in AI");
    expect(markup).toContain("Add your own provider");
    expect(markup).toContain("Test connection");
    expect(markup).toContain("Tell Nova what to automate");
    // The environment tab renders its saved variables (values shown to the
    // owner for editing; the agent only ever sees the names).
    expect(markup).toContain("Environment</button>");
    expect(markup).toContain("Variables for your deployments");
    expect(markup).toContain("STRIPE_API_KEY");
    expect(markup).toContain("Save environment variables");
    expect(markup).toContain("Disconnect GitHub");
    expect(markup).toContain("Connect Gmail");
    expect(markup).toContain("Vercel");
    expect(markup).toContain("Connect Vercel");
    expect(markup).toContain("Enter");
    expect(markup).not.toContain("Open Telegram");
    expect(markup).not.toContain("Codebuff");
    expect(markup).not.toContain("codebuff-api-key");
  });

  it("renders profile settings with Log out and Delete my account controls", () => {
    const markup = renderToStaticMarkup(<WorkspaceSettings />);
    expect(markup).toContain("Profile &amp; Account");
    expect(markup).toContain("Sign out of Nova");
    expect(markup).toContain("Log out");
    expect(markup).toContain("Delete account");
    expect(markup).toContain("Delete my account");
    // Deletion is guarded by an emailed code, not just a typed confirmation.
    expect(markup).toContain("Confirmed with a code sent to your email");
    expect(markup).not.toContain("Change password");
    expect(markup).not.toContain("Current password");
  });
});
