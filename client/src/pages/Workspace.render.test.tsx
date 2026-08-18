import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace from "./Workspace";

const state = vi.hoisted(() => ({
  computer: { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() },
  agentVmStatus: { data: { configured: false, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 0, maxRuns: 50, remainingRuns: 50, exhausted: false } }, isError: false, isLoading: false },
  nvidiaStatus: { data: { configured: false, reachable: false, providerConfigured: false, provider: "nvidia-nim", model: "nvidia/nemotron-3-nano-30b-a3b", allowance: { usedRequests: 0, maxRequests: 50, remainingRequests: 50, exhausted: false } }, isError: false, isLoading: false },
}));

const mutation = { mutate: vi.fn(), isPending: false };
const invalidate = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="workspace-shell">{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => state.computer } },
    agentVm: { status: { useQuery: () => state.agentVmStatus } },
    nvidia: { status: { useQuery: () => state.nvidiaStatus } },
    folders: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    files: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    chats: { create: { useMutation: () => mutation }, messages: { useQuery: () => ({ data: [], isLoading: false }) }, send: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { computer: { invalidate } }, chats: { messages: { invalidate } }, agentVm: { list: { invalidate } }, nvidia: { status: { invalidate } } }),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

const renderWorkspace = () => renderToStaticMarkup(<Workspace />);

describe("Workspace rendered browser states", () => {
  beforeEach(() => {
    state.computer = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
    state.agentVmStatus = { data: { configured: false, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 0, maxRuns: 50, remainingRuns: 50, exhausted: false } }, isError: false, isLoading: false };
    state.nvidiaStatus = { data: { configured: false, reachable: false, providerConfigured: false, provider: "nvidia-nim", model: "nvidia/nemotron-3-nano-30b-a3b", allowance: { usedRequests: 0, maxRequests: 50, remainingRequests: 50, exhausted: false } }, isError: false, isLoading: false };
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
    expect(markup).toContain("Usage");
    expect(markup).toContain("NVIDIA requests");
    expect(markup).toContain("VM runs");
    expect(markup).toContain("0/50");
    expect(markup).not.toContain("Ask NVIDIA");
    expect(markup).not.toContain("Run in agent VM");
    expect(markup).not.toContain("Codebuff");
  });

  it("renders loading, empty, and error states for the workspace browser", () => {
    state.computer = { data: undefined, isError: false, isLoading: true, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Opening your private workspace");

    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("This folder is ready for your work.");

    state.computer = { data: undefined, isError: true, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Nova could not open your computer.");
  });

  it("renders the current workspace usage counters without execution controls", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    state.agentVmStatus = { data: { configured: true, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 7, maxRuns: 50, remainingRuns: 43, exhausted: false } }, isError: false, isLoading: false };
    state.nvidiaStatus = { data: { configured: true, reachable: true, providerConfigured: true, provider: "nvidia-nim", model: "nvidia/nemotron-3-nano-30b-a3b", allowance: { usedRequests: 12, maxRequests: 50, remainingRequests: 38, exhausted: false } }, isError: false, isLoading: false };

    const markup = renderWorkspace();
    expect(markup).toContain("12/50");
    expect(markup).toContain("7/50");
    expect(markup).toContain("NVIDIA requests");
    expect(markup).toContain("VM runs");
    expect(markup).not.toContain("Describe a safe workspace task");
    expect(markup).not.toContain("Ask NVIDIA");
  });
});
