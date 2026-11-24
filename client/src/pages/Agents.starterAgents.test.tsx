import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Agents from "./Agents";

const state = vi.hoisted(() => ({
  agents: [] as Array<{
    id: number;
    name: string;
    role: string | null;
    instructions: string | null;
    emailAlias: string;
    phoneHandle: string;
    walletBudgetCredits: number | null;
    walletSpentCredits: number;
  }>,
  chats: [] as Array<{
    id: string;
    title: string;
    kind: "personal" | "team";
    goal: string | null;
    agentId: number | null;
    members: Array<{ id: number; name: string; role: string | null }>;
    updatedAt: Date;
  }>,
  pending: [] as Array<{
    id: number;
    agentId: number;
    agentName: string;
    action: "wallet_purchase" | "send_email";
    summary: string;
    status: "pending";
    resultSummary: string | null;
    chatId: string | null;
    createdAt: Date;
    decidedAt: Date | null;
  }>,
  recent: [] as Array<{
    id: number;
    agentId: number;
    agentName: string;
    action: "wallet_purchase" | "send_email";
    summary: string;
    status: "executed" | "denied" | "failed";
    resultSummary: string | null;
    chatId: string | null;
    createdAt: Date;
    decidedAt: Date | null;
  }>,
  inbox: [] as Array<{
    id: number;
    direction?: "outbound" | "inbound";
    autoReplied: boolean;
    fromAgentName: string;
    toAgentId: number | null;
    toAgentName: string | null;
    subject: string;
    body: string;
    createdAt: Date;
  }>,
  /** Effective Pro entitlement: a paid plan OR a console-operator role. */
  proAccess: true as boolean,
  isLoading: false,
}));

const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="agents-shell">{children}</main>
  ),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    agents: {
      list: {
        useQuery: () => ({ data: state.agents, isLoading: state.isLoading }),
      },
      chats: {
        useQuery: () => ({ data: state.chats, isLoading: state.isLoading }),
      },
      approvals: {
        useQuery: () => ({
          data: { pending: state.pending, recent: state.recent },
          isLoading: state.isLoading,
        }),
      },
      inbox: {
        useQuery: () => ({ data: state.inbox, isLoading: state.isLoading }),
      },
      create: { useMutation: () => mutation },
      update: { useMutation: () => mutation },
      delete: { useMutation: () => mutation },
      startChat: { useMutation: () => mutation },
      createTeam: { useMutation: () => mutation },
      approve: { useMutation: () => mutation },
      deny: { useMutation: () => mutation },
    },
    billing: {
      subscription: {
        useQuery: () => ({
          data: state.proAccess
            ? { plan: "paid", proAccess: true }
            : { plan: "free", proAccess: false },
          isLoading: false,
        }),
      },
    },
    useUtils: () => ({
      agents: {
        list: { invalidate: vi.fn() },
        chats: { invalidate: vi.fn() },
        approvals: { invalidate: vi.fn() },
        inbox: { invalidate: vi.fn() },
      },
    }),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app/agents", vi.fn()] }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const renderAgents = () => renderToStaticMarkup(<Agents />);

/** The markup of one starter card, from its testid to the next sibling. */
function block(markup: string, testid: string): string {
  const at = markup.indexOf(`data-testid="${testid}"`);
  if (at < 0) return "";
  const start = markup.lastIndexOf("<div", at);
  return start < 0 ? "" : markup.slice(start);
}

describe("the starter galleries", () => {
  beforeEach(() => {
    state.agents = [];
    state.chats = [];
    state.pending = [];
    state.recent = [];
    state.inbox = [];
    state.proAccess = true;
  });

  it("offers starter agents and starter teams beside the builders", () => {
    const markup = renderAgents();
    expect(markup).toContain('data-testid="starter-agents"');
    expect(markup).toContain('data-testid="starter-teams"');
    for (const name of ["Beacon", "Rook", "Scout", "Scribe"]) {
      expect(markup).toContain(`data-testid="starter-agent-${name}"`);
      expect(markup).toContain(`data-testid="starter-use-${name}"`);
    }
    for (const team of ["Launch crew", "Ship crew"]) {
      expect(markup).toContain(`data-testid="starter-team-${team}"`);
      expect(markup).toContain(`data-testid="starter-team-start-${team}"`);
    }
  });

  it("marks a starter agent the roster already holds instead of offering it twice", () => {
    state.agents = [
      {
        id: 3,
        name: "Scout",
        role: "Researcher",
        instructions: "mine now",
        emailAlias: "scout-1@nova.local",
        phoneHandle: "+1-555-0100",
        walletBudgetCredits: 500,
        walletSpentCredits: 0,
      },
    ];
    const markup = renderAgents();
    expect(markup).toContain('data-testid="starter-added-Scout"');
    expect(markup).not.toContain('data-testid="starter-use-Scout"');
    // The other three stay offerable.
    expect(markup).toContain('data-testid="starter-use-Scribe"');
  });

  it("shows which roster members a starter team would create", () => {
    const markup = renderAgents();
    const launch = block(markup, "starter-team-Launch crew");
    expect(launch).toContain("(new)");
    // With nothing owned, every member of both crews is a new agent.
    expect(markup).toContain("Creates Scout, Scribe, Beacon");
    expect(markup).toContain("Creates Rook, Beacon");
  });

  it("keeps a team's roster in turn order", () => {
    const markup = renderAgents();
    const launch = block(markup, "starter-team-Launch crew");
    expect(launch.indexOf("Scout")).toBeLessThan(launch.indexOf("Scribe"));
    expect(launch.indexOf("Scribe")).toBeLessThan(launch.indexOf("Beacon"));
  });

  it("locks both galleries behind Pro for an account without it", () => {
    state.proAccess = false;
    const markup = renderAgents();
    expect(markup).toContain('data-testid="starter-lock-Scout"');
    expect(markup).not.toContain('data-testid="starter-use-Scout"');
    expect(markup).toContain('data-testid="starter-team-lock-Launch crew"');
    expect(markup).not.toContain(
      'data-testid="starter-team-start-Launch crew"'
    );
  });
});
