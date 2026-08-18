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
    codebuff: { status: { useQuery: () => ({ data: { configured: true, provider: "codebuff", limits: { maxAgentSteps: 6 } } }) }, configure: { useMutation: () => mutation }, remove: { useMutation: () => mutation } },
    telegram: { status: { useQuery: () => ({ data: { configured: false, chatId: null } }) }, configure: { useMutation: () => mutation }, discoverChat: { useMutation: () => mutation }, sendTest: { useMutation: () => mutation }, remove: { useMutation: () => mutation } },
    auth: { deleteAccount: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { modelSettings: { invalidate: vi.fn() }, dashboard: { invalidate: vi.fn() } }, codebuff: { status: { invalidate: vi.fn() } }, telegram: { status: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("Codebuff settings card", () => {
  it("renders a password-only API key entry field and explicit external-service privacy boundary", () => {
    const markup = renderToStaticMarkup(<WorkspaceSettings />);
    expect(markup).toContain("Codebuff planner");
    expect(markup).toContain("id=\"codebuff-api-key\"");
    expect(markup).toContain("type=\"password\"");
    expect(markup).toContain("Save private key");
    expect(markup).toContain("planner has no Nova filesystem, shell, Daytona, deployment, or credential access");
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
