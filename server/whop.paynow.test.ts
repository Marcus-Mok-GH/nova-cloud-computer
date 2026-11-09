import { beforeEach, describe, expect, it, vi } from "vitest";

const setWhopCheckoutConfigIdForUser = vi.fn(async () => undefined);
const purchasePriorityForUser = vi.fn(async () => ({
  priority: false,
  armed: true,
  purchasedAt: new Date(),
  activatedAt: null as Date | null,
  expiresAt: null as Date | null,
}));
const recordWhopWebhookEvent = vi.fn(async () => true);
const upsertSubscriptionForUser = vi.fn(async () => ({ plan: "paid" as const, status: "active" }));
const ensureMonthlyAllocationForUser = vi.fn(async () => undefined);
const getOwnerIdForWhopMembership = vi.fn(async () => null);

vi.mock("./db", () => ({
  setWhopCheckoutConfigIdForUser,
  purchasePriorityForUser,
  recordWhopWebhookEvent,
  upsertSubscriptionForUser,
  ensureMonthlyAllocationForUser,
  getOwnerIdForWhopMembership,
}));

describe("Whop PayNow checkout configuration", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.WHOP_API_KEY = "whop_test_api_key_1234";
    process.env.WHOP_ACCOUNT_ID = "biz_test_account_1234";
    process.env.WHOP_WEBHOOK_SECRET = "ws_test_secret_1234";
    process.env.WHOP_PLAN_ID = "";
    process.env.WHOP_PRIORITY_PLAN_ID = "plan_priority_test";
    global.fetch = originalFetch;
  });

  function mockCheckoutResponse() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ id: "ch_test_1", purchase_url: "https://whop.com/checkout/ch_test_1" }),
        text: async () => "",
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return { calls, fetchMock };
  }

  it("enables PayNow on the Nova Pro checkout (inline variant)", async () => {
    const { calls } = mockCheckoutResponse();
    const { createWhopCheckout } = await import("./whop");
    const result = await createWhopCheckout({ ownerId: 42, planId: undefined, redirectUrl: "https://example.com/success" });
    expect(result.purchaseUrl).toBe("https://whop.com/checkout/ch_test_1");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.payment_method_configuration).toBeUndefined();
    expect(body.variant.payment_method_configuration).toEqual({ enabled: ["paynow"], disabled: [], include_platform_defaults: true });
    expect(body.variant.currency).toBe("sgd");
  });

  it("does not send checkout-level payment method config on priority checkout (variant carries PayNow)", async () => {
    const { calls } = mockCheckoutResponse();
    const { createWhopPriorityCheckout } = await import("./whop");
    const result = await createWhopPriorityCheckout({
      ownerId: 7,
      planId: "plan_priority_test",
      redirectUrl: "https://example.com/priority",
    });
    expect(result.purchaseUrl).toBe("https://whop.com/checkout/ch_test_1");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.payment_method_configuration).toBeUndefined();
    expect(body.variant_id).toBe("plan_priority_test");
  });
});
