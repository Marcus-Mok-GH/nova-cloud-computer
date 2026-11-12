/**
 * Unit tests for the Nova plan entitlement predicates. `hasProAccessForUser`
 * gates every Pro feature: an active paid plan OR a console-operator role.
 * `hasActiveAccessForUser` gates usage itself: a paid or plus plan, an
 * operator role, or a standard account still inside its 14-day trial.
 */
import { describe, expect, it, vi } from "vitest";
import { userSubscriptions, users } from "../../drizzle/schema";
import type { CreditRole } from "../credits";

const { getUserRole } = vi.hoisted(() => ({
  getUserRole: vi.fn(async (): Promise<CreditRole> => "user"),
}));
/** Rows for the userSubscriptions select; everything else the fake serves. */
let subscriptionRows: unknown[] = [];
/** Rows for the users select (the free-trial window is measured from createdAt). */
let userRows: unknown[] = [];
const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => (table === userSubscriptions ? subscriptionRows : table === users ? userRows : []),
      }),
    }),
  }),
};

vi.mock("./core", () => ({ requireDb: async () => fakeDb }));
vi.mock("./users", () => ({ getUserRole }));

const {
  getSubscriptionForUser,
  hasActiveAccessForUser,
  hasProAccessForUser,
  isFreeTrialActiveForUser,
} = await import("./credits");

describe("hasProAccessForUser", () => {
  it("grants Pro access to an admin role without any subscription", async () => {
    getUserRole.mockResolvedValue("admin");
    subscriptionRows = [];
    await expect(hasProAccessForUser(1)).resolves.toBe(true);
  });

  it("grants Pro access to a developer role without any subscription", async () => {
    getUserRole.mockResolvedValue("developer");
    subscriptionRows = [];
    await expect(hasProAccessForUser(2)).resolves.toBe(true);
  });

  it("denies a standard user on a free plan", async () => {
    getUserRole.mockResolvedValue("user");
    subscriptionRows = [];
    await expect(hasProAccessForUser(3)).resolves.toBe(false);
  });

  it("grants a standard user with an active paid subscription", async () => {
    getUserRole.mockResolvedValue("user");
    subscriptionRows = [
      {
        plan: "paid",
        status: "active",
        provider: "whop",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        cancelAtPeriodEnd: false,
        whopCheckoutConfigId: null,
      },
    ];
    await expect(hasProAccessForUser(4)).resolves.toBe(true);
  });

  it("a Plus subscription is not Pro access", async () => {
    getUserRole.mockResolvedValue("user");
    subscriptionRows = [
      {
        plan: "plus",
        status: "active",
        provider: "whop",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        cancelAtPeriodEnd: false,
        whopCheckoutConfigId: null,
      },
    ];
    await expect(hasProAccessForUser(6)).resolves.toBe(false);
  });
});

describe("getSubscriptionForUser tier mapping", () => {
  it("reports plus for an active plus subscription", async () => {
    subscriptionRows = [
      {
        plan: "plus",
        status: "active",
        provider: "whop",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        cancelAtPeriodEnd: false,
        whopCheckoutConfigId: null,
      },
    ];
    await expect(getSubscriptionForUser(1)).resolves.toMatchObject({ plan: "plus" });
  });

  it("reports free once the plus period has ended", async () => {
    subscriptionRows = [
      {
        plan: "plus",
        status: "active",
        provider: "whop",
        currentPeriodEnd: new Date(Date.now() - 86_400_000),
        cancelAtPeriodEnd: false,
        whopCheckoutConfigId: null,
      },
    ];
    await expect(getSubscriptionForUser(2)).resolves.toMatchObject({ plan: "free" });
  });

  it("reports paid for an active Pro subscription", async () => {
    subscriptionRows = [
      {
        plan: "paid",
        status: "active",
        provider: "whop",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        cancelAtPeriodEnd: false,
        whopCheckoutConfigId: null,
      },
    ];
    await expect(getSubscriptionForUser(3)).resolves.toMatchObject({ plan: "paid" });
  });
});

describe("isFreeTrialActiveForUser", () => {
  it("is active inside the 14-day window from account creation", async () => {
    userRows = [{ createdAt: new Date(Date.now() - 3 * 86_400_000) }];
    await expect(isFreeTrialActiveForUser(1)).resolves.toBe(true);
  });

  it("is active on the last day of the window", async () => {
    userRows = [{ createdAt: new Date(Date.now() - 13 * 86_400_000) }];
    await expect(isFreeTrialActiveForUser(2)).resolves.toBe(true);
  });

  it("is inactive once the 14-day window has passed", async () => {
    userRows = [{ createdAt: new Date(Date.now() - 15 * 86_400_000) }];
    await expect(isFreeTrialActiveForUser(3)).resolves.toBe(false);
  });

  it("stays active when the user row is missing (fail open, never lock someone out of data)", async () => {
    userRows = [];
    await expect(isFreeTrialActiveForUser(4)).resolves.toBe(true);
  });
});

describe("hasActiveAccessForUser", () => {
  // Usage entitlement: Pro access (a paid plan or an operator role) OR a
  // still-open 14-day free trial on a standard account.
  it("lets a fresh standard account use Nova inside the trial", async () => {
    getUserRole.mockResolvedValue("user");
    subscriptionRows = [];
    userRows = [{ createdAt: new Date(Date.now() - 86_400_000) }];
    await expect(hasActiveAccessForUser(1)).resolves.toBe(true);
  });

  it("ends when the trial window closes and no plan was bought", async () => {
    getUserRole.mockResolvedValue("user");
    subscriptionRows = [];
    userRows = [{ createdAt: new Date(Date.now() - 15 * 86_400_000) }];
    await expect(hasActiveAccessForUser(2)).resolves.toBe(false);
  });

  it("a paid plan overrides an expired trial", async () => {
    getUserRole.mockResolvedValue("user");
    subscriptionRows = [
      {
        plan: "paid",
        status: "active",
        provider: "whop",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        cancelAtPeriodEnd: false,
        whopCheckoutConfigId: null,
      },
    ];
    userRows = [{ createdAt: new Date(Date.now() - 400 * 86_400_000) }];
    await expect(hasActiveAccessForUser(3)).resolves.toBe(true);
  });

  it("a Plus plan keeps an old account usable after its trial would have closed", async () => {
    getUserRole.mockResolvedValue("user");
    subscriptionRows = [
      {
        plan: "plus",
        status: "active",
        provider: "whop",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        cancelAtPeriodEnd: false,
        whopCheckoutConfigId: null,
      },
    ];
    userRows = [{ createdAt: new Date(Date.now() - 400 * 86_400_000) }];
    await expect(hasActiveAccessForUser(6)).resolves.toBe(true);
  });

  it("a lapsed plan leaves an old account locked: the trial was spent long ago", async () => {
    getUserRole.mockResolvedValue("user");
    subscriptionRows = [
      {
        plan: "paid",
        status: "cancelled",
        provider: "whop",
        currentPeriodEnd: new Date(Date.now() - 86_400_000),
        cancelAtPeriodEnd: true,
        whopCheckoutConfigId: null,
      },
    ];
    userRows = [{ createdAt: new Date(Date.now() - 400 * 86_400_000) }];
    await expect(hasActiveAccessForUser(4)).resolves.toBe(false);
  });

  it("an operator role keeps access forever, trial clock ignored", async () => {
    getUserRole.mockResolvedValue("developer");
    subscriptionRows = [];
    userRows = [{ createdAt: new Date(Date.now() - 400 * 86_400_000) }];
    await expect(hasActiveAccessForUser(5)).resolves.toBe(true);
  });
});
