import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Credit-bundle webhooks.
 *
 * The security property under test: the number of credits granted comes from
 * OUR catalog, never from the webhook payload. A payload that claims a bigger
 * bundle, or names one that is not on the ladder, must not mint credits.
 */
const grantCreditTopUp = vi.fn(async () => ({ granted: true }));
const recordWhopWebhookEvent = vi.fn(async () => true);
const purchasePriorityForUser = vi.fn(async () => ({ priority: false, armed: true }));
const upsertSubscriptionForUser = vi.fn(async () => ({ plan: "paid" as const, status: "active" }));
const getOwnerIdForWhopMembership = vi.fn(async () => null);
const setWhopCheckoutConfigIdForUser = vi.fn(async () => undefined);

vi.mock("./db", () => ({
  hasActiveAccessForUser: vi.fn(async () => true),
  grantCreditTopUp,
  recordWhopWebhookEvent,
  purchasePriorityForUser,
  upsertSubscriptionForUser,
  getOwnerIdForWhopMembership,
  setWhopCheckoutConfigIdForUser,
}));

/** Signs a body the way Whop does, so verifyWhopWebhook accepts it. */
async function signedHeaders(body: string) {
  const crypto = await import("node:crypto");
  const secret = process.env.WHOP_WEBHOOK_SECRET as string;
  const id = "msg_credit_test";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Standard Webhooks format: HMAC-SHA256 over `id.timestamp.body`, base64
  // encoded, with the secret used as its literal UTF-8 bytes (no `ws_` strip).
  const signature = crypto
    .createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  grantCreditTopUp.mockResolvedValue({ granted: true });
  recordWhopWebhookEvent.mockResolvedValue(true);
  process.env.WHOP_API_KEY = "whop_test_api_key_1234";
  process.env.WHOP_ACCOUNT_ID = "biz_test_account_1234";
  process.env.WHOP_WEBHOOK_SECRET = "ws_test_secret_1234";
  process.env.WHOP_PLAN_ID = "";
  process.env.WHOP_PRIORITY_PLAN_ID = "plan_priority_test";
});

async function deliver(data: Record<string, unknown>, type = "payment.succeeded") {
  const body = JSON.stringify({ id: "evt_credit_1", type, data });
  const { handleWhopWebhook } = await import("./whop");
  return handleWhopWebhook(Buffer.from(body), await signedHeaders(body));
}

const creditPayment = (extra: Record<string, unknown> = {}) => ({
  id: "pay_credit_1",
  metadata: { nova_user_id: "42", nova_product: "credits", nova_credit_product_id: "topup-10" },
  ...extra,
});

describe("Whop credit bundle webhooks", () => {
  it("grants the bundle that the catalog defines", async () => {
    const outcome = await deliver(creditPayment());
    expect(outcome).toMatchObject({ handled: true, ownerId: 42, product: "credits", credits: 10_000, granted: true });
    expect(grantCreditTopUp).toHaveBeenCalledTimes(1);
    expect(grantCreditTopUp.mock.calls[0][0]).toMatchObject({
      ownerId: 42,
      providerPaymentId: "pay_credit_1",
      product: { id: "topup-10", priceCents: 1_000, credits: 10_000 },
      currency: "sgd",
    });
  });

  it("ignores a payload that claims a larger amount than the catalog grants", async () => {
    // A tampered/stale payload must not be able to mint credits: only the id is
    // read, and the size comes from the ladder.
    const outcome = await deliver(creditPayment({ nova_credit_amount: "9999999", credits: 9_999_999 }));
    expect(outcome).toMatchObject({ handled: true, credits: 10_000 });
    expect(grantCreditTopUp.mock.calls[0][0]).toMatchObject({
      product: { credits: 10_000 },
    });
  });

  it("refuses a bundle that is not on the ladder", async () => {
    const outcome = await deliver({
      id: "pay_credit_2",
      metadata: { nova_user_id: "42", nova_product: "credits", nova_credit_product_id: "topup-9999" },
    });
    expect(outcome).toMatchObject({ handled: false, reason: "unknown-credit-product" });
    expect(grantCreditTopUp).not.toHaveBeenCalled();
  });

  it("refuses a credit payment whose bundle id is missing entirely", async () => {
    // Marked as credits but with no product id: still unfulfillable, and must
    // not fall through to the generic "ignored event" path.
    const outcome = await deliver({
      id: "pay_credit_3",
      metadata: { nova_user_id: "42", nova_product: "credits" },
    });
    expect(outcome).toMatchObject({ handled: false, reason: "unknown-credit-product" });
    expect(grantCreditTopUp).not.toHaveBeenCalled();
  });

  it("does not grant when the payment cannot be tied to an account", async () => {
    const outcome = await deliver({
      id: "pay_credit_4",
      metadata: { nova_product: "credits", nova_credit_product_id: "topup-10" },
    });
    expect(outcome).toMatchObject({ handled: false, reason: "unknown-owner" });
    expect(grantCreditTopUp).not.toHaveBeenCalled();
  });

  it("does not double-grant a redelivered webhook", async () => {
    // Whop retries until it gets a 2xx, so a duplicate delivery is normal and the
    // dedupe must stop the second grant.
    recordWhopWebhookEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const first = await deliver(creditPayment());
    const second = await deliver(creditPayment());
    expect(first).toMatchObject({ handled: true, granted: true });
    expect(second).toMatchObject({ handled: false, reason: "duplicate-delivery" });
    expect(grantCreditTopUp).toHaveBeenCalledTimes(1);
  });

  it("reports granted:false when the payment id was already recorded", async () => {
    // The provider-level idempotency guard: a retried payment that is already in
    // the ledger must not add credits again.
    grantCreditTopUp.mockResolvedValueOnce({ granted: false });
    const outcome = await deliver(creditPayment());
    expect(outcome).toMatchObject({ handled: true, product: "credits", granted: false });
  });

  it("grants a one-time credit membership without touching Nova Pro", async () => {
    const outcome = await deliver(
      {
        id: "mem_credit_1",
        plan_id: "plan_credit_one_time",
        metadata: { nova_user_id: "7", nova_product: "credits", nova_credit_product_id: "topup-50" },
      },
      "membership.activated"
    );
    expect(outcome).toMatchObject({ handled: true, ownerId: 7, credits: 50_000 });
    expect(upsertSubscriptionForUser).not.toHaveBeenCalled();
  });

  it("does not grant a credit membership on a downgrade event", async () => {
    const outcome = await deliver(
      {
        id: "mem_credit_2",
        metadata: { nova_user_id: "7", nova_product: "credits", nova_credit_product_id: "topup-50" },
      },
      "membership.deactivated"
    );
    expect(outcome).toMatchObject({ handled: false, reason: "credit-membership-ignored" });
    expect(grantCreditTopUp).not.toHaveBeenCalled();
  });
});
