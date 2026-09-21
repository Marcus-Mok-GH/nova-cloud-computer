import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Terminal from "./Terminal";

const state = vi.hoisted(() => ({
  computer: { data: undefined as unknown, isError: false, isLoading: false, refetch: vi.fn() },
  status: { data: undefined as { active: boolean } | undefined, isError: false, isLoading: false, refetch: vi.fn() },
  readFetch: vi.fn(async () => ({ active: true, offset: 0, seq: 0, data: "", reset: false })),
}));

const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false };
const invalidate = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="terminal-shell-page">{children}</main> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => state.computer } },
    terminal: {
      status: { useQuery: () => state.status },
      start: { useMutation: () => mutation },
      write: { useMutation: () => mutation },
      resize: { useMutation: () => mutation },
      stop: { useMutation: () => mutation },
      read: { fetch: state.readFetch },
    },
    useUtils: () => ({ workspace: { computer: { invalidate } }, terminal: { status: { invalidate }, read: { fetch: state.readFetch } } }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80; rows = 24;
    loadAddon = vi.fn(); open = vi.fn(); reset = vi.fn(); write = vi.fn(); focus = vi.fn(); dispose = vi.fn();
    onData = vi.fn(); onResize = vi.fn();
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

const renderTerminal = () => renderToStaticMarkup(<Terminal />);

describe("Terminal page", () => {
  beforeEach(() => {
    state.computer = { data: { workspace: { id: 3 } }, isError: false, isLoading: false, refetch: vi.fn() };
    state.status = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };
  });

  it("offers connecting to the agent VM when no session is live", () => {
    state.status = { data: { active: false }, isError: false, isLoading: false, refetch: vi.fn() };
    const markup = renderTerminal();
    expect(markup).toContain("Terminal");
    expect(markup).toContain("Connect to agent VM");
    expect(markup).toContain("A live shell in your agent VM");
    expect(markup).toContain('data-testid="terminal-shell"');
    expect(markup).toContain('aria-label="Agent VM terminal"');
  });

  it("shows the session controls while a shell session is live", () => {
    state.status = { data: { active: true }, isError: false, isLoading: false, refetch: vi.fn() };
    const markup = renderTerminal();
    expect(markup).toContain("Reattach");
    expect(markup).toContain("Close session");
    expect(markup).not.toContain("Connect to agent VM");
  });

  it("explains how terminal changes relate to Files", () => {
    state.status = { data: { active: false }, isError: false, isLoading: false, refetch: vi.fn() };
    const markup = renderTerminal();
    expect(markup).toContain("Closing the session imports new files into Files");
  });

  it("falls back to a friendly message when the workspace is unreachable", () => {
    state.computer = { data: undefined, isError: true, isLoading: false, refetch: vi.fn() };
    const markup = renderTerminal();
    expect(markup).toContain("could not be reached");
  });
});
