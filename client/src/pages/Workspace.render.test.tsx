import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace, { TypingIndicator } from "./Workspace";
import { MISTRAL_UNAVAILABLE_PREFIX } from "@shared/const";

const state = vi.hoisted(() => ({
  computer: { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() },
  agentVmStatus: { data: { configured: false, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 0, maxRuns: 50, remainingRuns: 50, exhausted: false }, sandbox: { id: null, status: "unavailable" } }, isError: false, isLoading: false },
  mistralStatus: { data: { configured: false, reachable: false, providerConfigured: false, provider: "mistral", model: "mistral-medium-latest", allowance: { usedRequests: 0, maxRequests: 50, remainingRequests: 50, exhausted: false } }, isError: false, isLoading: false },
  chatMessages: [] as Array<{ id: number; role: "user" | "assistant"; content: string }>,
  agentRunStatus: { active: false as boolean },
  composioStatus: {
    data: {
      keyLength: 64,
      toolkits: {
        github: { configured: true, connected: false, status: "disconnected" as "active" | "disconnected", connectedAccountId: null as string | null },
        gmail: { configured: true, connected: false, status: "disconnected" as "active" | "disconnected", connectedAccountId: null as string | null },
      },
    },
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  },
  telegramStatus: {
    data: { configured: false, chatId: null as string | null },
    isLoading: false, isError: false, refetch: vi.fn(),
  },
}));

const mutation = { mutate: vi.fn(), isPending: false };
const invalidate = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="workspace-shell">{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => state.computer }, dashboard: { useQuery: () => ({ data: { projects: [], tasks: [] }, isLoading: false }) }, modelSettings: { useQuery: () => ({ data: null }) }, updateSettings: { useMutation: () => mutation } },
    agentVm: { status: { useQuery: () => state.agentVmStatus }, list: { useQuery: () => ({ data: [] }) } },
    composio: { status: { useQuery: () => state.composioStatus } },
    telegram: { status: { useQuery: () => state.telegramStatus } },
    mistral: { status: { useQuery: () => state.mistralStatus }, models: { useQuery: () => ({ data: [] }) } },
    folders: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    files: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    chats: { create: { useMutation: () => mutation }, messages: { useQuery: () => ({ data: state.chatMessages, isLoading: false }) }, runStatus: { useQuery: () => ({ data: state.agentRunStatus, isLoading: false, refetch: vi.fn() }) }, send: { useMutation: () => mutation } },
    automations: { list: { useQuery: () => ({ data: [] }) } },
    useUtils: () => ({ workspace: { computer: { invalidate } }, chats: { messages: { invalidate } }, agentVm: { list: { invalidate } }, mistral: { status: { invalidate } } }),
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
    state.agentVmStatus = { data: { configured: false, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 0, maxRuns: 50, remainingRuns: 50, exhausted: false }, sandbox: { id: null, status: "unavailable" } }, isError: false, isLoading: false };
    state.mistralStatus = { data: { configured: false, reachable: false, providerConfigured: false, provider: "mistral", model: "mistral-medium-latest", allowance: { usedRequests: 0, maxRequests: 50, remainingRequests: 50, exhausted: false } }, isError: false, isLoading: false };
    state.chatMessages = [];
    state.agentRunStatus = { active: false };
    state.composioStatus = {
      data: {
        keyLength: 64,
        toolkits: {
          github: { configured: true, connected: false, status: "disconnected" as "active" | "disconnected", connectedAccountId: null as string | null },
          gmail: { configured: true, connected: false, status: "disconnected" as "active" | "disconnected", connectedAccountId: null as string | null },
        },
      },
      isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
    };
    state.telegramStatus = { data: { configured: false, chatId: null }, isLoading: false, isError: false, refetch: vi.fn() };
  });

  it("renders the start-chat prompt box as a real textarea with a disabled send button until text is entered", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    const markup = renderWorkspace();
    expect(markup).toContain("<textarea");
    expect(markup).toContain("What do you want Nova to help with?");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>\s*Start a chat/);
  });

  it("renders workspace asset counts without folder browsing controls", () => {
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
    expect(markup).toContain("What are we working on?");
    expect(markup).toContain("Ask Nova anything about your work");
    expect(markup).toContain("Connectors Nova can use");
    expect(markup).toContain("GitHub");
    expect(markup).toContain("Gmail");
    expect(markup).not.toContain("Cloud VM");
    expect(markup).toContain("Connect");
    expect(markup).not.toContain("Pick up where you left off");
    expect(markup).not.toContain("Plans");
    expect(markup).not.toContain("Workspace folders");
    expect(markup).not.toContain("Ask Mistral");
    expect(markup).not.toContain("Run in agent VM");
    expect(markup).not.toContain("Codebuff");
  });

  it("shows the Telegram connector as Ready only when a chat is linked, not when only the bot token is set", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    state.composioStatus = {
      data: {
        keyLength: 64,
        toolkits: {
          github: { configured: true, connected: false, status: "disconnected" as const, connectedAccountId: null },
          gmail: { configured: true, connected: false, status: "disconnected" as const, connectedAccountId: null },
        },
      },
      isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
    };
    state.telegramStatus = { data: { configured: true, chatId: null }, isLoading: false, isError: false, refetch: vi.fn() };
    let markup = renderWorkspace();
    expect(markup).not.toContain("Ready");
    state.telegramStatus = { data: { configured: true, chatId: "424242" }, isLoading: false, isError: false, refetch: vi.fn() };
    markup = renderWorkspace();
    expect(markup).toContain("Ready");
  });

  it("shows a connected connector as Ready and an unconnected one as Connect", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    state.composioStatus = {
      data: {
        keyLength: 64,
        toolkits: {
          github: { configured: true, connected: true, status: "active" as const, connectedAccountId: "acc_1" },
          gmail: { configured: true, connected: false, status: "disconnected" as "active" | "disconnected", connectedAccountId: null },
        },
      },
      isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
    };
    const markup = renderWorkspace();
    expect(markup).toContain("Ready");
    expect(markup).toContain("Connect");
  });

  it("renders loading, empty, and error states for the workspace summary", () => {
    state.computer = { data: undefined, isError: false, isLoading: true, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("What are we working on?");

    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Connectors Nova can use");

    state.computer = { data: undefined, isError: true, isLoading: false, refetch: vi.fn() };
    expect(renderWorkspace()).toContain("Nova could not open your computer.");
  });

  it("renders the overview home without execution controls", () => {
    state.computer = { data: { folders: [], files: [] }, isError: false, isLoading: false, refetch: vi.fn() };
    state.agentVmStatus = { data: { configured: true, limits: { activeRunsPerWorkspace: 1, timeoutSeconds: 30, ttlMinutes: 20, network: "blocked" }, allowance: { usedRuns: 7, maxRuns: 50, remainingRuns: 43, exhausted: false }, sandbox: { id: null, status: "unavailable" } }, isError: false, isLoading: false };
    state.mistralStatus = { data: { configured: true, reachable: true, providerConfigured: true, provider: "mistral", model: "mistral-medium-latest", allowance: { usedRequests: 12, maxRequests: 50, remainingRequests: 38, exhausted: false } }, isError: false, isLoading: false };

    const markup = renderWorkspace();
    expect(markup).toContain("Start a chat");
    expect(markup).toContain("Connectors Nova can use");
    expect(markup).not.toContain("Workspace folders");
    expect(markup).not.toContain("Describe a safe workspace task");
    expect(markup).not.toContain("Ask Mistral");
    expect(markup).not.toContain("Run in agent VM");
    expect(markup).not.toContain("Codebuff");
  });

  it("renders an unavailable-AI persisted message as an explicit error, with the actual gateway error visible", () => {
    state.chatMessages = [
      { id: 1, role: "assistant", content: `${MISTRAL_UNAVAILABLE_PREFIX}fetch failed to https://api.mistral.ai/v1/chat/completions: connection reset` },
    ];
    const markup = renderChat();
    expect(markup).toContain('data-testid="assistant-error"');
    expect(markup).toContain("Nova is offline");
    expect(markup).toContain("Mistral inference gateway error");
    expect(markup).toContain("connection reset");

    // A plain assistant reply never matches the error prefix.
    state.chatMessages = [{ id: 1, role: "assistant", content: "Mistral is a fine model" }];
    const plainMarkup = renderChat();
    expect(plainMarkup).not.toContain('data-testid="assistant-error"');
    expect(plainMarkup).toContain("Mistral is a fine model");
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

  it("shows active work from the backend run ledger after a refresh", () => {
    state.chatMessages = [
      { id: 1, role: "user", content: "Handle this task" },
      { id: 2, role: "assistant", content: '__nova_tool_activity__:{"id":"tool-1","name":"read_file","state":"running","args":{}}' },
    ];
    state.agentRunStatus = { active: true };
    const markup = renderChat();
    expect(markup).toContain('data-testid="agent-working-status"');
    expect(markup).toContain("Nova is actively working");
    expect(markup).toContain('data-testid="typing-indicator"');
  });

  it("renders an explicit animated status for the working state", () => {
    const markup = renderToStaticMarkup(<TypingIndicator />);
    expect(markup).toContain('data-testid="typing-indicator"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Nova is actively working");
    expect(markup).toContain("animate-spin");
  });
});
