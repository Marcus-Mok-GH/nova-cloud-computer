import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace, { TypingIndicator } from "./Workspace";
import { NVIDIA_UNAVAILABLE_MESSAGE } from "@shared/const";

const state = vi.hoisted(() => ({
  computer: { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() },
  agentVmStatus: { data: { configured: false, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 0, maxRuns: 50, remainingRuns: 50, exhausted: false } }, isError: false, isLoading: false },
  nvidiaStatus: { data: { configured: false, reachable: false, providerConfigured: false, provider: "nvidia-nim", model: "nvidia/nemotron-3-nano-30b-a3b", allowance: { usedRequests: 0, maxRequests: 50, remainingRequests: 50, exhausted: false } }, isError: false, isLoading: false },
  chatMessages: [] as Array<{ id: number; role: "user" | "assistant"; content: string }>,
}));

const mutation = { mutate: vi.fn(), isPending: false };
const invalidate = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="workspace-shell">{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => state.computer }, modelSettings: { useQuery: () => ({ data: null }) }, updateSettings: { useMutation: () => mutation } },
    agentVm: { status: { useQuery: () => state.agentVmStatus } },
    nvidia: { status: { useQuery: () => state.nvidiaStatus }, models: { useQuery: () => ({ data: [] }) } },
    folders: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    files: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    chats: { create: { useMutation: () => mutation }, messages: { useQuery: () => ({ data: state.chatMessages, isLoading: false }) }, send: { useMutation: () => mutation } },
    useUtils: () => ({ workspace: { computer: { invalidate } }, chats: { messages: { invalidate } }, agentVm: { list: { invalidate } }, nvidia: { status: { invalidate } } }),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

const renderWorkspace = () => renderToStaticMarkup(<Workspace />);

const renderChat = () => {
  globalThis.window = { location: { search: "?chatId=1" } } as unknown as Window & typeof globalThis;
  return renderWorkspace();
};

describe("Workspace rendered browser states", () => {
  beforeEach(() => {
    state.computer = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
    state.agentVmStatus = { data: { configured: false, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 0, maxRuns: 50, remainingRuns: 50, exhausted: false } }, isError: false, isLoading: false };
    state.nvidiaStatus = { data: { configured: false, reachable: false, providerConfigured: false, provider: "nvidia-nim", model: "nvidia/nemotron-3-nano-30b-a3b", allowance: { usedRequests: 0, maxRequests: 50, remainingRequests: 50, exhausted: false } }, isError: false, isLoading: false };
    state.chatMessages = [];
  });

  it("renders workspace counts without folder browsing controls", () => {
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
    expect(markup).toContain("Home");
    expect(markup).toContain("Workspace");
    expect(markup).toContain("VM runs used");
    expect(markup).toContain("1");
    expect(markup).toContain("0/50");
    expect(markup).not.toContain("Plans");
    expect(markup).not.toContain("launch-brief.md");
    expect(markup).not.toContain("Workspace folders");
    expect(markup).not.toContain("Ask NVIDIA");
    expect(markup).not.toContain("Run in agent VM");
    expect(markup).not.toContain("Codebuff");
  });

  it("renders loading, empty, and error states for the workspace summary", () => {
    state.computer = { data: undefined, isError: false, isLoading: true, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("—");

    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("folders");
    expect(renderWorkspace()).toContain("files");

    state.computer = { data: undefined, isError: true, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Nova could not open your computer.");
  });

  it("renders the current workspace usage counters without execution controls", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    state.agentVmStatus = { data: { configured: true, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 7, maxRuns: 50, remainingRuns: 43, exhausted: false } }, isError: false, isLoading: false };
    state.nvidiaStatus = { data: { configured: true, reachable: true, providerConfigured: true, provider: "nvidia-nim", model: "nvidia/nemotron-3-nano-30b-a3b", allowance: { usedRequests: 12, maxRequests: 50, remainingRequests: 38, exhausted: false } }, isError: false, isLoading: false };

    const markup = renderWorkspace();
    expect(markup).toContain("7/50");
    expect(markup).toContain("VM runs used");
    expect(markup).not.toContain("Workspace folders");
    expect(markup).not.toContain("Describe a safe workspace task");
    expect(markup).not.toContain("Ask NVIDIA");
  });

  it("renders an unavailable-AI persisted message as an explicit error", () => {
    state.chatMessages = [{ id: 1, role: "assistant", content: NVIDIA_UNAVAILABLE_MESSAGE }];
    const markup = renderChat();
    expect(markup).toContain('data-testid="assistant-error"');
    expect(markup).toContain("Nova is offline");
    expect(markup).toContain(NVIDIA_UNAVAILABLE_MESSAGE);
  });

  it("renders a normal persisted assistant message as a regular bubble with exactly one label", () => {
    state.chatMessages = [
      { id: 1, role: "user", content: "Hi Nova" },
      { id: 2, role: "assistant", content: "Hello there" },
    ];
    const markup = renderChat();
    expect(markup).not.toContain('data-testid="assistant-error"');
    expect(markup).toContain("Hello there");
    expect((markup.match(/Nova App/g) || []).length).toBe(1);
  });

  it("shows exactly one label for two consecutive assistant messages", () => {
    state.chatMessages = [
      { id: 1, role: "assistant", content: "First reply" },
      { id: 2, role: "assistant", content: "Second reply" },
    ];
    const markup = renderChat();
    expect(markup).toContain("Second reply");
    expect((markup.match(/Nova App/g) || []).length).toBe(1);
  });

  it("does not render the typing indicator while idle", () => {
    state.chatMessages = [];
    const markup = renderChat();
    expect(markup).not.toContain('data-testid="typing-indicator"');
  });

  it("renders an animated typing indicator for the working state", () => {
    const markup = renderToStaticMarkup(<TypingIndicator />);
    expect(markup).toContain('data-testid="typing-indicator"');
    expect(markup).toContain("typing-dot");
    expect((markup.match(/typing-dot/g) || []).length).toBe(3);
  });
});
