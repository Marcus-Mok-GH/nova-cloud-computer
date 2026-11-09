/**
 * Router-level test for the Nova Pro gate on agent team creation. The
 * builder is locked in the client, but the rule must hold for every client,
 * so the createTeam proc re-checks the subscription before creating anything.
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
const createTeamChatForUser = vi.fn(async () => ({
  ok: true as const,
  chat: { id: "chat_team_1", title: "Launch crew", kind: "team" as const, teamGoal: "Plan the launch" },
  members: [],
}));

vi.mock("./db", () => ({ getSubscriptionForUser }));
vi.mock("./agents", () => ({
  AgentNameTakenError: class extends Error {},
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

describe("agents.createTeam plan gate", () => {
  beforeEach(() => {
    getSubscriptionForUser.mockClear();
    createTeamChatForUser.mockClear();
    getSubscriptionForUser.mockResolvedValue({
      plan: "free",
      status: "inactive",
      provider: "whop",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      whopCheckoutConfigId: null,
    });
  });

  it("refuses team creation for a free account", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.agents.createTeam(teamInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Agent teams are part of Nova Pro. Upgrade to create one.",
    });
    expect(getSubscriptionForUser).toHaveBeenCalledWith(1);
    expect(createTeamChatForUser).not.toHaveBeenCalled();
  });

  it("lets a paid account create a team", async () => {
    getSubscriptionForUser.mockResolvedValueOnce({
      plan: "paid",
      status: "active",
      provider: "whop",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      cancelAtPeriodEnd: false,
      whopCheckoutConfigId: null,
    });
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.agents.createTeam(teamInput);
    expect(createTeamChatForUser).toHaveBeenCalledWith(1, teamInput);
    expect(result.ok).toBe(true);
    expect(result.chat.id).toBe("chat_team_1");
  });
});
