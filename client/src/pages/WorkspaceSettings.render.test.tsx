import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceSettings from "./WorkspaceSettings";

const mutation = { mutate: vi.fn(), isPending: false };
vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { modelSettings: { useQuery: () => ({ data: { workspaceRules: null, customModels: [], activeProvider: "anthropic", activeCustomModelId: null }, isLoading: false, isError: false, refetch: vi.fn() }) }, updateSettings: { useMutation: () => mutation }, dashboard: { invalidate: vi.fn() } },
    models: { createCustom: { useMutation: () => mutation }, deleteCustom: { useMutation: () => mutation } },
    telegram: { status: { useQuery: () => ({ data: { configured: false, chatId: null } }) }, configure: { useMutation: () => mutation }, discoverChat: { useMutation: () => mutation }, sendTest: { useMutation: () => mutation }, remove: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { modelSettings: { invalidate: vi.fn() }, dashboard: { invalidate: vi.fn() } }, telegram: { status: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("WorkspaceSettings rendered browser states", () => {
  it("renders workspace preferences and model configuration options", () => {
    const markup = renderToStaticMarkup(<WorkspaceSettings />);
    expect(markup).toContain("Preferences with a memory");
    expect(markup).toContain("Choose a model home");
    expect(markup).toContain("Anthropic");
    expect(markup).toContain("Telegram Bot");
  });
});
