import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceSettings from "./WorkspaceSettings";

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, email: "test@example.com", name: "Test User" }, logout: vi.fn() }) }));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { modelSettings: { useQuery: () => ({ data: { workspaceRules: null, customModels: [], activeProvider: "anthropic", activeCustomModelId: null }, isLoading: false, isError: false, refetch: vi.fn() }) }, updateSettings: { useMutation: () => mutation }, dashboard: { invalidate: vi.fn() } },
    models: { createCustom: { useMutation: () => mutation }, deleteCustom: { useMutation: () => mutation }, testCustom: { useMutation: () => mutation } },
    mistral: { status: { useQuery: () => ({ data: { model: "mistral-large-latest" }, isLoading: false, isError: false, refetch: vi.fn() } ) } },
    telegram: { status: { useQuery: () => ({ data: { configured: true, chatId: "42", botUsername: "nova_test_bot", webhook: { linked: true } } }) }, modelSettings: { useQuery: () => ({ data: { modelId: "test", options: [] } }) }, updateModel: { useMutation: () => mutation }, configure: { useMutation: () => mutation }, discoverChat: { useMutation: () => mutation }, sendTest: { useMutation: () => mutation }, remove: { useMutation: () => mutation } },
    automations: { list: { useQuery: () => ({ data: [], isLoading: false, isError: false }) }, runs: { useQuery: () => ({ data: [], isLoading: false }) }, update: { useMutation: () => mutation }, runDue: { useMutation: () => mutation } },
    auth: { deleteAccount: { useMutation: () => mutation } },
    composio: { status: { useQuery: () => ({ data: { keyLength: 40, toolkits: { github: { configured: true, connected: true, status: "active", connectedAccountId: "acc_github" }, gmail: { configured: true, connected: false, status: "disconnected", connectedAccountId: null } } }, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }) }, connect: { useMutation: () => mutation }, disconnect: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { modelSettings: { invalidate: vi.fn() }, dashboard: { invalidate: vi.fn() } }, telegram: { status: { invalidate: vi.fn() } }, automations: { list: { invalidate: vi.fn() }, runs: { invalidate: vi.fn() } }, composio: { status: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

describe("Workspace settings page", () => {
  it("renders workspace rules, Telegram connection, and natural-language automations", () => {
    const markup = renderToStaticMarkup(<WorkspaceSettings />);
    expect(markup).toContain("Workspace rules");
    expect(markup).toContain("How Nova should help");
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
    expect(markup).toContain("Disconnect GitHub");
    expect(markup).toContain("Connect Gmail");
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
    expect(markup).not.toContain("Change password");
    expect(markup).not.toContain("Current password");
  });
});
