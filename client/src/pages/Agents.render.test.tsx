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
    walletBudgetCredits: number;
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
    fromAgentName: string;
    toAgentId: number | null;
    toAgentName: string | null;
    subject: string;
    body: string;
    createdAt: Date;
  }>,
  isLoading: false,
}));

const mutation = { mutate: vi.fn(), isPending: false };

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="agents-shell">{children}</main>
  ),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    agents: {
      list: { useQuery: () => ({ data: state.agents, isLoading: state.isLoading }) },
      chats: { useQuery: () => ({ data: state.chats, isLoading: state.isLoading }) },
      approvals: {
        useQuery: () => ({ data: { pending: state.pending, recent: state.recent }, isLoading: state.isLoading }),
      },
      inbox: { useQuery: () => ({ data: state.inbox, isLoading: state.isLoading }) },
      create: { useMutation: () => mutation },
      update: { useMutation: () => mutation },
      delete: { useMutation: () => mutation },
      startChat: { useMutation: () => mutation },
      createTeam: { useMutation: () => mutation },
      approve: { useMutation: () => mutation },
      deny: { useMutation: () => mutation },
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

/** The opening tag of the "New team" button - matched by its label so
 * Tailwind's always-present `disabled:` utility classes cannot fake a
 * disabled state (and regardless of which conditional title it got). */
function teamCreateButtonTag(markup: string): string {
  const labelAt = markup.indexOf("New team</button>");
  if (labelAt < 0) return "";
  const start = markup.lastIndexOf("<button", labelAt);
  return start < 0 ? "" : markup.slice(start, labelAt);
}

describe("Agents page rendered states", () => {
  beforeEach(() => {
    state.agents = [];
    state.chats = [];
    state.pending = [];
    state.recent = [];
    state.inbox = [];
    state.isLoading = false;
    mutation.mutate.mockClear();
  });

  it("renders the identity-focused header and an empty-agents prompt", () => {
    const markup = renderAgents();
    expect(markup).toContain("Agents");
    expect(markup).toContain("identity, wallet");
    expect(markup).toContain("No agents yet");
    expect(markup).toContain("New agent");
  });

  it("renders an agent card with its identity, wallet, and chat entry point", () => {
    state.agents = [
      {
        id: 11,
        name: "Mira",
        role: "Researcher",
        instructions: "Research first.",
        emailAlias: "mira-4f2a@nova.local",
        phoneHandle: "+1-555-0142",
        walletBudgetCredits: 500,
        walletSpentCredits: 120,
      },
    ];
    const markup = renderAgents();
    expect(markup).toContain('data-testid="agent-11"');
    expect(markup).toContain("Mira");
    expect(markup).toContain("Researcher");
    expect(markup).toContain("mira-4f2a@nova.local");
    expect(markup).toContain("+1-555-0142");
    expect(markup).toContain("380 of 500 credits left");
    expect(markup).toContain("Open chat");
    // The empty-state prompt disappears once an agent exists.
    expect(markup).not.toContain("No agents yet");
  });

  it("shows a pending approval with Approve and Decline controls", () => {
    state.pending = [
      {
        id: 12,
        agentId: 11,
        agentName: "Mira",
        action: "wallet_purchase",
        summary: 'Purchase "domain name" for 40 credits',
        status: "pending",
        resultSummary: null,
        chatId: null,
        createdAt: new Date("2026-10-02T09:00:00Z"),
        decidedAt: null,
      },
    ];
    const markup = renderAgents();
    expect(markup).toContain('data-testid="approval-12"');
    expect(markup).toContain("Waiting for your approval (1)");
    // renderToStaticMarkup escapes the quotes in the summary.
    expect(markup).toContain("domain name");
    expect(markup).toContain("for 40 credits");
    expect(markup).toContain("Approve");
    expect(markup).toContain("Decline");
  });

  it("lists recent decisions as the wallet's transaction history", () => {
    state.recent = [
      {
        id: 9,
        agentId: 11,
        agentName: "Mira",
        action: "wallet_purchase",
        summary: 'Purchase "domain name" for 40 credits',
        status: "denied",
        resultSummary: "The user declined this request.",
        chatId: null,
        createdAt: new Date("2026-10-01T09:00:00Z"),
        decidedAt: new Date("2026-10-01T10:00:00Z"),
      },
    ];
    const markup = renderAgents();
    expect(markup).toContain("Recent decisions");
    expect(markup).toContain("The user declined this request.");
  });

  it("renders a team chat with its members and shared goal", () => {
    state.chats = [
      {
        id: "chat000000000000000001",
        title: "Launch crew",
        kind: "team",
        goal: "Plan the New York launch end to end",
        agentId: null,
        members: [
          { id: 11, name: "Mira", role: "Researcher" },
          { id: 12, name: "Pip", role: "Writer" },
        ],
        updatedAt: new Date("2026-10-02T09:00:00Z"),
      },
    ];
    const markup = renderAgents();
    expect(markup).toContain('data-testid="team-chat000000000000000001"');
    expect(markup).toContain("Launch crew");
    expect(markup).toContain("Plan the New York launch end to end");
    expect(markup).toContain("Mira");
    expect(markup).toContain("Pip");
    expect(markup).toContain("Open chat");
    // Teams cannot be created without at least two agents.
    expect(teamCreateButtonTag(markup)).toContain('disabled=""');
  });

  it("enables team creation once two agents exist", () => {
    state.agents = [
      { id: 11, name: "Mira", role: null, instructions: null, emailAlias: "mira-1@nova.local", phoneHandle: "+1-555-0101", walletBudgetCredits: 500, walletSpentCredits: 0 },
      { id: 12, name: "Pip", role: null, instructions: null, emailAlias: "pip-2@nova.local", phoneHandle: "+1-555-0102", walletBudgetCredits: 500, walletSpentCredits: 0 },
    ];
    const markup = renderAgents();
    expect(markup).toContain("No teams yet");
    // With two agents the New team control is clickable (not disabled).
    expect(teamCreateButtonTag(markup)).not.toContain('disabled=""');
  });

  it("shows the agent inbox when mail has been delivered", () => {
    state.inbox = [
      {
        id: 3,
        fromAgentName: "Mira",
        toAgentId: 12,
        toAgentName: "Pip",
        subject: "Shortlist ready",
        body: "Three venues look promising.",
        createdAt: new Date("2026-10-02T09:00:00Z"),
      },
    ];
    const markup = renderAgents();
    expect(markup).toContain("Agent inbox");
    expect(markup).toContain("Shortlist ready");
    expect(markup).toContain("Three venues look promising.");
    expect(markup).toContain("From Mira to Pip");
  });
});
