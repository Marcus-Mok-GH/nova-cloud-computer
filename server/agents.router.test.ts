/**
 * Router-level test for the Nova Pro gate on agent creation. The builders
 * are locked in the client, but the rule must hold for every client, so the
 * create and createTeam procs re-check Pro entitlement before creating
 * anything (an active paid plan or a console-operator role).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getSubscriptionForUser = vi.fn(async () => ({
  plan: "free" as "free" | "paid",
  status: "inactive",
  provider: "whop",
  currentPeriodEnd: null as Date | null,
  cancelAtPeriodEnd: false,
  whopCheckoutConfigId: null as string | null,
}));
/** The Pro-entitlement gate (paid subscription OR console-operator role). */
const hasProAccessForUser = vi.fn(async () => false);
const createAgentForUser = vi.fn(async (userId: number, input: unknown) => ({
  id: 42,
  userId,
  name: input && typeof input === "object" && "name" in input ? (input as { name: string }).name : "Mira",
  role: null,
  instructions: null,
  emailAlias: "mira-9e1d@nova.local",
  phoneHandle: "+1-555-0199",
  walletBudgetCredits: null,
  walletSpentCredits: 0,
}));
const createTeamChatForUser = vi.fn(async () => ({
  ok: true as const,
  chat: { id: "chat_team_1", title: "Launch crew", kind: "team" as const, teamGoal: "Plan the launch" },
  members: [],
}));

vi.mock("./db", () => ({ getSubscriptionForUser, hasProAccessForUser }));
vi.mock("./agents", () => ({
  AgentNameTakenError: class extends Error {},
  createAgentForUser,
  createTeamChatForUser,
}));

const { appRouter } = await import("./routers");

type UserRow = TrpcContext["user"];
function contextFor(user: UserRow): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
function userRow(id: number): UserRow {
  return {
    id,
    openId: `user-${id}`,
    email: `user${id}@example.com`,
    name: null,
    loginMethod: "test",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

const teamInput = { name: "Launch crew", goal: "Plan the launch", agentIds: [11, 12] };

describe("agents.createTeam Pro gate", () => {
  beforeEach(() => {
    getSubscriptionForUser.mockClear();
    createTeamChatForUser.mockClear();
    hasProAccessForUser.mockClear();
    hasProAccessForUser.mockResolvedValue(false);
  });

  it("refuses team creation without Pro access", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.agents.createTeam(teamInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Agent teams are part of Nova Pro. Upgrade to create one.",
    });
    expect(hasProAccessForUser).toHaveBeenCalledWith(1);
    expect(createTeamChatForUser).not.toHaveBeenCalled();
  });

  it("lets an account with Pro access create a team", async () => {
    hasProAccessForUser.mockResolvedValueOnce(true);
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.agents.createTeam(teamInput);
    expect(createTeamChatForUser).toHaveBeenCalledWith(1, teamInput);
    expect(result.ok).toBe(true);
    expect(result.chat.id).toBe("chat_team_1");
  });
});

const agentInput = {
  name: "Mira",
  role: "Researcher",
  instructions: "Research first.",
  walletBudgetCredits: 500,
};

describe("agents.create Pro gate", () => {
  beforeEach(() => {
    getSubscriptionForUser.mockClear();
    createAgentForUser.mockClear();
    hasProAccessForUser.mockClear();
    hasProAccessForUser.mockResolvedValue(false);
  });

  it("refuses agent creation without Pro access", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.agents.create(agentInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Personal agents are part of Nova Pro. Upgrade to create one.",
    });
    expect(hasProAccessForUser).toHaveBeenCalledWith(1);
    expect(createAgentForUser).not.toHaveBeenCalled();
  });

  it("lets an account with Pro access create an agent", async () => {
    hasProAccessForUser.mockResolvedValueOnce(true);
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const agent = await caller.agents.create(agentInput);
    expect(createAgentForUser).toHaveBeenCalledWith(1, agentInput);
    expect(agent.id).toBe(42);
  });

  it("lets an operator on a free subscription create an agent", async () => {
    // The entitlement, not the raw subscription, is what the gate reads: an
    // operator (mocked true above) must pass even though the subscription
    // says free, and the subscription must not even be consulted.
    hasProAccessForUser.mockResolvedValueOnce(true);
    getSubscriptionForUser.mockResolvedValue({
      plan: "free",
      status: "inactive",
      provider: "whop",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      whopCheckoutConfigId: null,
    });
    const caller = appRouter.createCaller(contextFor(userRow(2)));
    const agent = await caller.agents.create(agentInput);
    expect(agent.id).toBe(42);
    expect(getSubscriptionForUser).not.toHaveBeenCalled();
  });
});
