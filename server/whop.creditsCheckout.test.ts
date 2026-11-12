import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCreditTopUpProduct } from "@shared/creditTopUps";

/**
 * Credit checkout variant selection.
 *
 * The production company API key can reference an existing variant but cannot
 * create one inline (Whop answers 403 "not authorized"), so a pinned
 * `WHOP_CREDIT_PLAN_IDS` entry must switch the checkout body from an inline
 * `variant` to a `variant_id` reference - the same shape Pro and Priority use.
 * Without a pin the body keeps the inline variant (dev setups).
 */
const setWhopCheckoutConfigIdForUser = vi.fn(async () => undefined);

vi.mock("./db", () => ({
  hasActiveAccessForUser: vi.fn(async () => true),
  setWhopCheckoutConfigIdForUser,
}));

describe("Whop credit top-up checkout variant selection", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.WHOP_API_KEY = "whop_test_api_key_1234";
    process.env.WHOP_ACCOUNT_ID = "biz_test_account_1234";
    process.env.WHOP_CREDIT_PLAN_IDS = "";
    global.fetch = originalFetch;
  });

  function mockCheckoutResponse() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          id: "ch_test_1",
          purchase_url: "https://whop.com/checkout/ch_test_1",
        }),
        text: async () => "",
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return { calls, fetchMock };
  }

  it("references the pinned variant via variant_id when WHOP_CREDIT_PLAN_IDS maps the bundle", async () => {
    process.env.WHOP_CREDIT_PLAN_IDS = JSON.stringify({
      "topup-10": "plan_credit_10",
    });
    const { calls } = mockCheckoutResponse();
    const { createWhopCreditTopUpCheckout } = await import("./whop");
    const result = await createWhopCreditTopUpCheckout({
      ownerId: 42,
      product: getCreditTopUpProduct("topup-10")!,
      redirectUrl: "https://example.com/credits",
    });
    expect(result.purchaseUrl).toBe("https://whop.com/checkout/ch_test_1");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.variant_id).toBe("plan_credit_10");
    expect(body.variant).toBeUndefined();
    // The credit amount still travels in the metadata, not the variant.
    expect(body.metadata.nova_credit_product_id).toBe("topup-10");
    expect(body.metadata.nova_credit_amount).toBe("10000");
  });

  it("falls back to an inline variant when the bundle is not in the pinned map", async () => {
    process.env.WHOP_CREDIT_PLAN_IDS = JSON.stringify({
      "topup-10": "plan_credit_10",
    });
    const { calls } = mockCheckoutResponse();
    const { createWhopCreditTopUpCheckout } = await import("./whop");
    await createWhopCreditTopUpCheckout({
      ownerId: 42,
      product: getCreditTopUpProduct("topup-5")!,
      redirectUrl: "https://example.com/credits",
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.variant_id).toBeUndefined();
    expect(body.variant.billing_type).toBe("one_time");
    expect(body.variant.initial_price).toBe(5);
    expect(body.variant.metadata).toBeUndefined();
  });

  it("uses an inline variant when no pinned map is configured at all", async () => {
    process.env.WHOP_CREDIT_PLAN_IDS = "";
    const { calls } = mockCheckoutResponse();
    const { createWhopCreditTopUpCheckout } = await import("./whop");
    await createWhopCreditTopUpCheckout({
      ownerId: 42,
      product: getCreditTopUpProduct("topup-20")!,
      redirectUrl: undefined,
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.variant_id).toBeUndefined();
    expect(body.variant.billing_type).toBe("one_time");
    expect(body.variant.initial_price).toBe(20);
  });

  it("ignores an unparseable WHOP_CREDIT_PLAN_IDS and keeps the inline fallback", async () => {
    process.env.WHOP_CREDIT_PLAN_IDS = "not-json";
    const { calls } = mockCheckoutResponse();
    const { createWhopCreditTopUpCheckout } = await import("./whop");
    await createWhopCreditTopUpCheckout({
      ownerId: 42,
      product: getCreditTopUpProduct("topup-30")!,
      redirectUrl: undefined,
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.variant_id).toBeUndefined();
    expect(body.variant.billing_type).toBe("one_time");
  });

  it("sends variant_id (no inline variant) with the production key shape, so Whop does not reject with 403 forbidden", async () => {
    process.env.WHOP_CREDIT_PLAN_IDS = JSON.stringify({
      "topup-10": "plan_credit_10",
    });
    const { calls, fetchMock } = mockCheckoutResponse();
    // Production company key: inline variant creation is refused.
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body));
      if (body.variant && !body.variant_id) {
        return { ok: false, status: 403, text: async () => JSON.stringify({ error: { type: "forbidden", message: "You are not authorized" } }), json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ id: "ch_test_2", purchase_url: "https://whop.com/checkout/ch_test_2" }), text: async () => "" };
    });
    const { createWhopCreditTopUpCheckout } = await import("./whop");
    const result = await createWhopCreditTopUpCheckout({
      ownerId: 42,
      product: getCreditTopUpProduct("topup-10")!,
      redirectUrl: "https://example.com/credits",
    });
    expect(result.purchaseUrl).toBe("https://whop.com/checkout/ch_test_2");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.variant_id).toBe("plan_credit_10");
    expect(body.variant).toBeUndefined();
  });
});
