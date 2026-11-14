import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const createChatForUser = vi.fn(async () => ({
  id: "c00000000000000000000001",
  model: null,
  effort: null,
}));
const getChatForUser = vi.fn(
  async (): Promise<{ id: string; model: string; effort: string | null }> => ({
    id: "c0000000000000000000000001",
    model: "nova-ultra",
    effort: "high",
  })
);
const getSubscriptionForUser = vi.fn(async () => ({ plan: "free" }));
/** The Pro-entitlement gate (paid subscription OR console-operator role). */
const hasProAccessForUser = vi.fn(async () => false);

vi.mock("./db", () => ({
  hasActiveAccessForUser: vi.fn(async () => true),
  createChatForUser,
  getChatForUser,
  getSubscriptionForUser,
  hasProAccessForUser,
}));

vi.mock("./whop", () => ({
  createWhopCheckout: vi.fn(),
  createWhopPriorityCheckout: vi.fn(),
  getWhopPlanId: vi.fn(() => "plan_pro"),
  getWhopPriorityPlanId: vi.fn(() => "plan_BFyuf6PmE5wwz"),
  isWhopConfigured: vi.fn(() => true),
  isWhopCheckoutDebug: () => false,
  WhopNotConfiguredError: class extends Error {},
  whopConfigurationMessage: () => "Nova Pro is not configured on this deployment.",
  whopPriorityConfigurationMessage: () =>
    "Priority purchases are not configured on this deployment yet.",
}));

const { appRouter } = await import("./routers");

type UserRow = TrpcContext["user"];
function contextFor(user: UserRow): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
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

describe("chats model + effort router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSubscriptionForUser.mockResolvedValue({ plan: "free" });
    hasProAccessForUser.mockResolvedValue(false);
    createChatForUser.mockResolvedValue({ id: "c1", model: null, effort: null });
  });

  it("stores a free conversation with null model and null effort", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await caller.chats.create({ title: "Task" });
    // Free model + auto effort both persist as null.
    expect(createChatForUser).toHaveBeenCalledWith(1, "Task", null, null);
  });

  it("rejects a premium model on a free plan", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(
      caller.chats.create({ title: "Task", model: "nova-ultra", effort: "high" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createChatForUser).not.toHaveBeenCalled();
  });

  it("stores a premium model + supported effort on a Pro-access account", async () => {
    hasProAccessForUser.mockResolvedValue(true);
    const caller = appRouter.createCaller(contextFor(userRow(2)));
    await caller.chats.create({ title: "Task", model: "nova-ultra", effort: "high" });
    expect(createChatForUser).toHaveBeenCalledWith(2, "Task", "nova-ultra", "high");
  });

  it("downgrades an effort the model does not offer to auto (null)", async () => {
    hasProAccessForUser.mockResolvedValue(true);
    const caller = appRouter.createCaller(contextFor(userRow(3)));
    // deepseek-v4.1-flash only offers "auto"; "max" must fall back to null.
    await caller.chats.create({
      title: "Task",
      model: "deepseek-v4.1-flash",
      effort: "max",
    });
    expect(createChatForUser).toHaveBeenCalledWith(
      3,
      "Task",
      "deepseek-v4.1-flash",
      null
    );
  });

  it("rejects a model id that is not in the catalogue", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(4)));
    await expect(
      caller.chats.create({ title: "Task", model: "does-not-exist" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createChatForUser).not.toHaveBeenCalled();
  });

  it("reports the chat's effort (auto when unset) via chats.models", async () => {
    getChatForUser.mockResolvedValueOnce({
      id: "c1",
      model: "nova-ultra",
      effort: null,
    });
    const caller = appRouter.createCaller(contextFor(userRow(5)));
    const result = await caller.chats.models({ chatId: "c1" });
    expect(result.effort).toBe("auto");
    expect(result.current).toBe("nova-ultra");
  });

  it("reports the effective plan in chats.models: an operator reads paid", async () => {
    getChatForUser.mockResolvedValueOnce({
      id: "c1",
      model: "nova-ultra",
      effort: null,
    });
    hasProAccessForUser.mockResolvedValueOnce(true);
    getSubscriptionForUser.mockResolvedValueOnce({ plan: "free" });
    const caller = appRouter.createCaller(contextFor(userRow(6)));
    const result = await caller.chats.models({ chatId: "c1" });
    expect(result.plan).toBe("paid");
  });
});
