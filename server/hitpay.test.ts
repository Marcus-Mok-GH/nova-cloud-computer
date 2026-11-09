import { beforeEach, describe, expect, it, vi } from "vitest";

const purchasePriorityForUser = vi.fn(async () => ({ priority: false, armed: true, purchasedAt: new Date(), activatedAt: null as Date | null, expiresAt: null as Date | null }));
const ensureMonthlyAllocationForUser = vi.fn(async () => undefined);
const recordWhopWebhookEvent = vi.fn(async () => true);

vi.mock("./db", () => ({
  purchasePriorityForUser,
  ensureMonthlyAllocationForUser,
  recordWhopWebhookEvent,
}));

vi.mock("./db/core", () => ({
  requireDb: vi.fn(async () => ({
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
  })),
}));

vi.mock("../drizzle/schema", () => ({
  userSubscriptions: { ownerId: "ownerId" },
}));

vi.mock("./credits", () => ({ PAID_PLAN_PRICE_CENTS: 799, PAID_PLAN_CURRENCY: "sgd" }));
vi.mock("./db/priority", () => ({ PRIORITY_PRICE_CENTS: 499, PRIORITY_CURRENCY: "sgd" }));

describe("HitPay PayNow", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.HITPAY_API_KEY = "hitpay_test_api_key_1234";
    process.env.HITPAY_WEBHOOK_SALT = "hitsalt-test-1234";
    global.fetch = originalFetch;
  });

  function mockPaymentResponse() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ id: "payreq_1", url: "https://securecheckout.hit-pay.com/checkout" }),
        text: async () => "",
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return { calls };
  }

  it("creates a PayNow payment request with paynow_online", async () => {
    const { calls } = mockPaymentResponse();
    const { createHitPayPaymentRequest } = await import("./hitpay");
    const result = await createHitPayPaymentRequest({ ownerId: 42, product: "priority", redirectUrl: "https://example.com/return" });
    expect(result.url).toBe("https://securecheckout.hit-pay.com/checkout");
    expect(result.referenceNumber).toMatch(/^nova-priority-42-/);
    const body = String(calls[0].init.body);
    expect(body).toContain("paynow_online");
    expect(body).toContain("amount=4.99");
    expect(body).toContain("currency=sgd");
    expect(calls[0].init.headers).toMatchObject({ "X-BUSINESS-API-KEY": expect.any(String) });
  });

  it("parses reference numbers", async () => {
    const { parseHitPayReferenceNumber } = await import("./hitpay");
    expect(parseHitPayReferenceNumber("nova-pro-7-abc12345")).toEqual({ product: "pro", ownerId: 7 });
    expect(parseHitPayReferenceNumber("nova-priority-9-deadbeef")).toEqual({ product: "priority", ownerId: 9 });
    expect(parseHitPayReferenceNumber("bad")).toBeNull();
  });

  it("verifies HitPay webhook signature (HMAC-SHA256 hex)", async () => {
    const { verifyHitPayWebhook } = await import("./hitpay");
    const crypto = await import("node:crypto");
    const payload = JSON.stringify({ id: "evt1", status: "completed", reference_number: "nova-priority-7-deadbeef", amount: "4.99", currency: "sgd" });
    const signature = crypto.createHmac("sha256", "hitsalt-test-1234").update(payload).digest("hex");
    const result = verifyHitPayWebhook(payload, signature);
    expect(result.referenceNumber).toBe("nova-priority-7-deadbeef");
  });

  it("grants priority on completed webhook", async () => {
    const { handleHitPayWebhook } = await import("./hitpay");
    const crypto = await import("node:crypto");
    const payload = JSON.stringify({ id: "payreq_priority", status: "completed", reference_number: "nova-priority-7-deadbeef", amount: "4.99", currency: "sgd" });
    const signature = crypto.createHmac("sha256", "hitsalt-test-1234").update(payload).digest("hex");
    const outcome = await handleHitPayWebhook(payload, signature);
    expect(outcome).toEqual({ handled: true, ownerId: 7, product: "priority", paymentRequestId: "payreq_priority" });
    expect(purchasePriorityForUser).toHaveBeenCalledWith(7);
  });
});
