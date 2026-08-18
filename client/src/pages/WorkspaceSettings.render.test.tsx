import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceSettings from "./WorkspaceSettings";

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, email: "test@example.com", name: "Test User" },
    logout: vi.fn(),
  }),
}));
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { modelSettings: { useQuery: () => ({ data: { workspaceRules: null, customModels: [], activeProvider: "anthropic", activeCustomModelId: null }, isLoading: false, isError: false, refetch: vi.fn() }) }, updateSettings: { useMutation: () => mutation }, dashboard: { invalidate: vi.fn() } },
    models: { createCustom: { useMutation: () => mutation }, deleteCustom: { useMutation: () => mutation } },
    telegram: { status: { useQuery: () => ({ data: { configured: false, chatId: null } }) }, configure: { useMutation: () => mutation }, discoverChat: { useMutation: () => mutation }, sendTest: { useMutation: () => mutation }, remove: { useMutation: () => mutation } },
    automations: { list: { useQuery: () => ({ data: [{ id: 9, kind: "workspace_digest", enabled: false }], isLoading: false, isError: false }) }, runs: { useQuery: () => ({ data: [], isLoading: false }) }, update: { useMutation: () => mutation } },
    auth: { deleteAccount: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { modelSettings: { invalidate: vi.fn() }, dashboard: { invalidate: vi.fn() } }, telegram: { status: { invalidate: vi.fn() } }, automations: { list: { invalidate: vi.fn() }, runs: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("Workspace settings page", () => {
  it("renders model preferences without Codebuff planner controls", () => {
    const markup = renderToStaticMarkup(<WorkspaceSettings />);
    expect(markup).toContain("Choose a model home");
    expect(markup).toContain("Telegram Bot");
    expect(markup).not.toContain("Codebuff");
    expect(markup).not.toContain("codebuff-api-key");
  });

  it("renders Account settings section with Log out button and Delete my account button", () => {
    const markup = renderToStaticMarkup(<WorkspaceSettings />);
    expect(markup).toContain("Account settings");
    expect(markup).toContain("Sign out of Nova");
    expect(markup).toContain("Log out");
    expect(markup).toContain("Delete account");
    expect(markup).toContain("Delete my account");
  });
});
