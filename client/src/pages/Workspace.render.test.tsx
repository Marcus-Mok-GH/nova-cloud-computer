import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace, { getAgentVmPollInterval } from "./Workspace";

const state = vi.hoisted(() => ({
  computer: { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() },
  agentVmStatus: { data: { configured: false, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 0, maxRuns: 50, remainingRuns: 50, exhausted: false } }, isError: false, isLoading: false },
  agentVmRuns: { data: [] as Array<{ id: number; provider?: string; task: string; status: string; resultSummary: string | null; errorMessage: string | null }>, isError: false, isLoading: false },
}));

const mutation = { mutate: vi.fn(), isPending: false };
const invalidate = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="workspace-shell">{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => state.computer } },
    agentVm: { status: { useQuery: () => state.agentVmStatus }, list: { useQuery: () => state.agentVmRuns }, start: { useMutation: () => mutation }, cancel: { useMutation: () => mutation } },
    folders: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    files: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    chats: { create: { useMutation: () => mutation }, messages: { useQuery: () => ({ data: [], isLoading: false }) }, send: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { computer: { invalidate } }, chats: { messages: { invalidate } }, agentVm: { list: { invalidate } } }),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

const renderWorkspace = () => renderToStaticMarkup(<Workspace />);

describe("Workspace rendered browser states", () => {
  beforeEach(() => {
    state.computer = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
    state.agentVmStatus = { data: { configured: false, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 0, maxRuns: 50, remainingRuns: 50, exhausted: false } }, isError: false, isLoading: false };
    state.agentVmRuns = { data: [], isError: false, isLoading: false };
  });

  it("renders persisted root folders and files from the workspace computer query", () => {
    state.computer = {
      data: {
        folders: [{ id: 1, name: "Plans", parentId: null }],
        files: [{ id: 2, name: "launch-brief.md", folderId: null, updatedAt: new Date() }],
      },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };

    const markup = renderWorkspace();
    expect(markup).toContain("Plans");
    expect(markup).toContain("launch-brief.md");
    expect(markup).toContain("Workspace folders");
    expect(markup).toContain("Agent VM");
    expect(markup).toContain("Setup needed");
  });

  it("renders loading, empty, and error states for the workspace browser", () => {
    state.computer = { data: undefined, isError: false, isLoading: true, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Opening your private workspace");

    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("This folder is ready for your work.");

    state.computer = { data: undefined, isError: true, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Nova could not open your computer.");
  });

  it("renders private agent VM history and the enforced execution limits", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    state.agentVmStatus = { data: { configured: true, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 1, maxRuns: 50, remainingRuns: 49, exhausted: false } }, isError: false, isLoading: false };
    state.agentVmRuns = { data: [{ id: 9, provider: "daytona", task: "Inspect workspace notes", status: "succeeded", resultSummary: "2 files inspected", errorMessage: null }], isError: false, isLoading: false };

    const markup = renderWorkspace();
    expect(markup).toContain("Run in agent VM");
    expect(markup).toContain("Inspect workspace notes");
    expect(markup).toContain("1 active run");
    expect(markup).toContain("network access stays blocked");
    expect(markup).toContain("1/50 configured run cap");
    expect(markup).toContain("Daytona VM");
  });

  it("polls active VM work quickly and reflects the next completed run snapshot", () => {
    expect(getAgentVmPollInterval([{ status: "running" }])).toBe(1250);
    expect(getAgentVmPollInterval([{ status: "succeeded" }])).toBe(5000);
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    state.agentVmRuns = { data: [{ id: 14, task: "Summarize notes", status: "running", resultSummary: null, errorMessage: null }], isError: false, isLoading: false };
    expect(renderWorkspace()).toContain("running");
    state.agentVmRuns = { data: [{ id: 14, task: "Summarize notes", status: "succeeded", resultSummary: "Summary stored", errorMessage: null }], isError: false, isLoading: false };
    const completed = renderWorkspace();
    expect(completed).toContain("succeeded");
    expect(completed).toContain("Summary stored");
  });
});
