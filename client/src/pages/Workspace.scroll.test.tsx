// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace from "./Workspace";

const fixture = vi.hoisted(() => ({
  messages: [] as Array<{ id: number; role: "user" | "assistant"; content: string }>,
  liveEvents: [] as Array<Record<string, unknown>>,
  working: true,
  scrolledUp: { current: false },
  emptyQuery: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
}));

const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false };

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="workspace-shell">{children}</main>
  ),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: {
      computer: { useQuery: fixture.emptyQuery },
      envVarRequests: { useQuery: () => ({ data: [], isLoading: false }) },
      fulfillEnvVarRequest: { useMutation: () => mutation },
      cancelEnvVarRequest: { useMutation: () => mutation },
      dashboard: { useQuery: () => ({ data: { projects: [], tasks: [] }, isLoading: false }) },
      modelSettings: { useQuery: () => ({ data: null }) },
      personalities: {
        useQuery: () => ({
          data: {
            personalities: [{
              id: "default", name: "Default", description: "", instructions: null,
              detail: null, collaboration: null, expertise: null, builtIn: true,
            }],
            activePersonalityId: "default",
          },
          isLoading: false,
        }),
      },
      setActivePersonality: { useMutation: () => mutation },
      updateSettings: { useMutation: () => mutation },
    },
    agentVm: { status: { useQuery: fixture.emptyQuery }, list: { useQuery: () => ({ data: [] }) } },
    composio: { status: { useQuery: () => ({ data: { keyLength: 0, toolkits: {} } }) } },
    telegram: { status: { useQuery: () => ({ data: {} }) } },
    ai: { status: { useQuery: fixture.emptyQuery }, models: { useQuery: () => ({ data: [] }) } },
    folders: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    files: { create: { useMutation: () => mutation }, update: { useMutation: () => mutation }, delete: { useMutation: () => mutation } },
    chats: {
      create: { useMutation: () => mutation },
      messages: { useQuery: () => ({ data: fixture.messages, isLoading: false }) },
      runStatus: { useQuery: () => ({ data: { active: fixture.working }, isLoading: false, refetch: vi.fn() }) },
      send: { useMutation: () => mutation },
      stop: { useMutation: () => mutation },
      revert: { useMutation: () => mutation },
      models: { useQuery: () => ({ data: { models: [], current: "nova-pro", plan: "free" }, isLoading: false }) },
      setModel: { useMutation: () => mutation },
    },
    billing: { createCheckout: { useMutation: () => mutation }, subscription: { useQuery: () => ({ data: { plan: "free", proAccess: true, accessActive: true } }) } },
    automations: { list: { useQuery: () => ({ data: [] }) } },
    useUtils: () => ({
      workspace: { computer: { invalidate: vi.fn() }, envVarRequests: { invalidate: vi.fn() } },
      chats: { messages: { invalidate: vi.fn() } },
      agentVm: { list: { invalidate: vi.fn() } },
      ai: { status: { invalidate: vi.fn() } },
    }),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app", vi.fn()], useSearch: () => "" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useWorkspaceChat", () => ({
  useWorkspaceChat: () => ({
    draft: "", setDraft: vi.fn(), composerAttachments: [], setComposerAttachments: vi.fn(),
    preparingAttachments: false, composerImageInputRef: { current: null },
    addChatAttachments: vi.fn(), canSendComposer: false, submit: vi.fn(), sendMessage: vi.fn(),
    handleRegenerate: vi.fn(),
    savedMessages: { data: fixture.messages, isLoading: false },
    queueNotice: null, priorityNotice: null, agentIsWorking: fixture.working,
    composerBusy: false, pendingUserContent: "", baselineMessageId: 0,
    liveEvents: fixture.liveEvents, stopLedgerCutoffId: 0, settledWhileAway: false,
    revertChat: vi.fn(), userScrolledUpRef: fixture.scrolledUp,
    pendingEnvVarRequests: [], fulfillEnvVarRequest: vi.fn(), dismissEnvVarRequest: vi.fn(),
    fulfillingEnvVarRequest: false,
  }),
}));

let container: HTMLDivElement;
let root: Root;
let writes: Array<{ value: number; stack: string }> = [];

function findViewport(): HTMLElement {
  const el = container.querySelector<HTMLElement>(".overflow-y-auto.overscroll-contain");
  if (!el) throw new Error("chat viewport not found");
  return el;
}

function instrument() {
  const el = findViewport();
  let value = 0;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 3000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 500 });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => value,
    set: (next: number) => {
      writes.push({ value: next, stack: new Error().stack ?? "" });
      value = next;
    },
  });
  Object.defineProperty(el, "__setScrollTop", {
    configurable: true,
    value: (next: number) => { value = next; },
  });
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { search: "?chatId=1", origin: "http://localhost", href: "http://localhost/app?chatId=1" },
  });
  fixture.messages = [
    { id: 1, role: "user", content: "first task" },
    { id: 2, role: "assistant", content: "__nova_tool_activity__:" + JSON.stringify({
        id: "t1", name: "run_command", state: "running", args: { command: "ls" },
        detail: "Reading files", progressLog: ["Reading files"],
      }),
    },
  ];
  fixture.liveEvents = [{ kind: "tool", activity: {
    id: "t1", name: "run_command", state: "running", args: { command: "ls" },
    detail: "Reading files", progressLog: ["Reading files"],
  } }];
  fixture.working = true;
  writes = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

describe("workspace chat scroll", () => {
  beforeEach(() => {
    fixture.scrolledUp.current = false;
  });

  it("pins the viewport to the bottom when a tool row arrives while working", () => {
    act(() => root.render(<Workspace />));
    instrument();
    fixture.liveEvents = [
      ...fixture.liveEvents,
      { kind: "tool", activity: {
        id: "t2", name: "run_command", state: "running", args: { command: "pwd" },
        detail: "Checking the path", progressLog: ["Checking the path"],
      } },
    ];
    fixture.messages = [
      ...fixture.messages,
      { id: 3, role: "assistant", content: "__nova_tool_activity__:" + JSON.stringify({
          id: "t2", name: "run_command", state: "running", args: { command: "pwd" },
          detail: "Checking the path", progressLog: ["Checking the path"],
        }),
      },
    ];
    act(() => root.render(<Workspace />));
    expect(writes.at(-1)?.value).toBe(3000);
  });

  it("does not mistake its own pin for the user scrolling away", () => {
    act(() => root.render(<Workspace />));
    instrument();
    fixture.liveEvents = [
      ...fixture.liveEvents,
      { kind: "tool", activity: {
        id: "t3", name: "run_command", state: "running", args: { command: "date" },
        detail: "Checking the clock", progressLog: ["Checking the clock"],
      } },
    ];
    act(() => root.render(<Workspace />));
    act(() => {
      findViewport().dispatchEvent(new Event("scroll"));
    });
    // The scroll event was produced by the pin itself; the run must keep following.
    expect(fixture.scrolledUp.current).toBe(false);
  });

  it("offers a scroll-to-bottom button when the reader is up the thread", async () => {
    act(() => root.render(<Workspace />));
    instrument();
    // Let the mount pin finish so its own scroll event is ignored.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
    });
    const el = findViewport();
    (el as unknown as { __setScrollTop: (n: number) => void }).__setScrollTop(0);
    act(() => el.dispatchEvent(new Event("scroll")));
    const button = container.querySelector<HTMLButtonElement>('[data-testid="scroll-to-bottom"]');
    expect(button).not.toBeNull();
    act(() => button!.click());
    expect(writes.at(-1)?.value).toBe(3000);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();
  });
});
