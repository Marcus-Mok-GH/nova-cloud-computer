/**
 * Unit tests for the Nova Pro entitlement predicate. `hasProAccessForUser`
 * gates every Pro feature: an active paid plan OR a console-operator role.
 * The credit funding source stays subscription-based - an operator's runs
 * spend their role's daily credits (developer: unlimited, admin: elevated),
 * never a monthly pool - so `isPaidPlanForUser` must keep returning false
 * for an unsubscribed operator.
 */
import { describe, expect, it, vi } from "vitest";
import { userSubscriptions } from "../../drizzle/schema";

const { getUserRole } = vi.hoisted(() => ({ getUserRole: vi.fn(async () => "user" as const) }));
/** Rows for the userSubscriptions select; everything else the fake serves. */
let subscriptionRows: unknown[] = [];
const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => (table === userSubscriptions ? subscriptionRows : []),
      }),
    }),
  }),
};

vi.mock("./core", () => ({ requireDb: async () => fakeDb }));
vi.mock("./users", () => ({ getUserRole }));

const { hasProAccessForUser, isPaidPlanForUser } = await import("./credits");

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
});

describe("isPaidPlanForUser stays subscription-based", () => {
  it("an unsubscribed operator is not a paid-plan owner", async () => {
    // Funding source guard: the operator short-circuit must not leak into
    // the predicate that decides whose runs draw from the monthly pool.
    getUserRole.mockResolvedValue("admin");
    subscriptionRows = [];
    await expect(isPaidPlanForUser(1)).resolves.toBe(false);
    getUserRole.mockResolvedValue("developer");
    await expect(isPaidPlanForUser(2)).resolves.toBe(false);
  });

  it("a paid standard user is a paid-plan owner", async () => {
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
    await expect(isPaidPlanForUser(3)).resolves.toBe(true);
  });
});
