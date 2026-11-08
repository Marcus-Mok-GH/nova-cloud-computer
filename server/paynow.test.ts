import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PayNow priority webhooks. Stripe signs deliveries with `t=...,v1=...`
 * HMAC-SHA256 over `timestamp.body` (hex digest, secret used as UTF-8 bytes),
 * and a replayed or forged signature must never arm priority. The state
 * changes themselves are mocked: these tests cover the signature scheme and
 * the metadata-to-Nova-action mapping.
 */
const purchasePriorityForUser = vi.fn(async () => ({
  priority: false,
  armed: true,
  purchasedAt: new Date(),
  activatedAt: null as Date | null,
  expiresAt: null as Date | null,
}));
const recordWhopWebhookEvent = vi.fn(async () => true);

vi.mock("./db", () => ({
  purchasePriorityForUser,
  recordWhopWebhookEvent,
}));

const signingSecret = "whsec_stripe-route-test-secret";

function signedHeaders(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = createHmac("sha256", Buffer.from(signingSecret, "utf8")).update(`${timestamp}.${body}`).digest("hex");
  return { "stripe-signature": `t=${timestamp},v1=${signature}` };
}

function checkoutCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_stripe_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        payment_status: "paid",
        metadata: { nova_user_id: "1", nova_product: "priority" },
        ...overrides,
      },
    },
  };
}

describe("PayNow (Stripe) priority webhooks", () => {
  beforeEach(() => {
    purchasePriorityForUser.mockClear();
    recordWhopWebhookEvent.mockClear();
    recordWhopWebhookEvent.mockResolvedValue(true);
    process.env.STRIPE_SECRET_KEY = "sk_test_paynow";
    process.env.STRIPE_WEBHOOK_SECRET = signingSecret;
    vi.resetModules();
  });

  it("arms priority on checkout.session.completed for the priority product", async () => {
    const { handleStripeWebhook } = await import("./paynow");
    const rawBody = Buffer.from(JSON.stringify(checkoutCompletedEvent()));
    const outcome = await handleStripeWebhook(rawBody, signedHeaders(rawBody.toString("utf8")));
    expect(outcome).toEqual({ type: "checkout.session.completed", priorityArmed: true, subscriptionUpdated: false, ownerId: 1 });
    expect(purchasePriorityForUser).toHaveBeenCalledWith(1);
  });

  it("ignores events that are not checkout.session.completed", async () => {
    const { handleStripeWebhook } = await import("./paynow");
    const event = { id: "evt_stripe_2", type: "charge.refunded", data: { object: {} } };
    const rawBody = Buffer.from(JSON.stringify(event));
    const outcome = await handleStripeWebhook(rawBody, signedHeaders(rawBody.toString("utf8")));
    expect(outcome.priorityArmed).toBe(false);
    expect(outcome.skipped).toBe("unhandled-event");
    expect(purchasePriorityForUser).not.toHaveBeenCalled();
  });

  it("ignores a duplicate delivery instead of arming priority twice", async () => {
    const { handleStripeWebhook } = await import("./paynow");
    recordWhopWebhookEvent.mockResolvedValue(false);
    const rawBody = Buffer.from(JSON.stringify(checkoutCompletedEvent()));
    const outcome = await handleStripeWebhook(rawBody, signedHeaders(rawBody.toString("utf8")));
    expect(outcome.priorityArmed).toBe(false);
    expect(outcome.skipped).toBe("duplicate-event");
    expect(purchasePriorityForUser).not.toHaveBeenCalled();
  });

  it("does nothing when the session has no Nova metadata", async () => {
    const { handleStripeWebhook } = await import("./paynow");
    const rawBody = Buffer.from(JSON.stringify(checkoutCompletedEvent({ metadata: null })));
    const outcome = await handleStripeWebhook(rawBody, signedHeaders(rawBody.toString("utf8")));
    expect(outcome.priorityArmed).toBe(false);
    expect(outcome.skipped).toBe("not-nova-product");
    expect(purchasePriorityForUser).not.toHaveBeenCalled();
  });

  it("does nothing when the session cannot be resolved to a Nova account", async () => {
    const { handleStripeWebhook } = await import("./paynow");
    const rawBody = Buffer.from(JSON.stringify(checkoutCompletedEvent({ metadata: { nova_product: "priority" } })));
    const outcome = await handleStripeWebhook(rawBody, signedHeaders(rawBody.toString("utf8")));
    expect(outcome.priorityArmed).toBe(false);
    expect(outcome.skipped).toBe("unknown-owner");
    expect(purchasePriorityForUser).not.toHaveBeenCalled();
  });

  it("rejects a forged signature", async () => {
    const { handleStripeWebhook } = await import("./paynow");
    const rawBody = Buffer.from(JSON.stringify(checkoutCompletedEvent()));
    const headers = signedHeaders(rawBody.toString("utf8"));
    headers["stripe-signature"] = headers["stripe-signature"].replace(/v1=.*/, "v1=deadbeef");
    await expect(handleStripeWebhook(rawBody, headers)).rejects.toThrow(/signature/i);
    expect(purchasePriorityForUser).not.toHaveBeenCalled();
  });

  it("rejects a signature whose timestamp is outside the tolerance window", async () => {
    const { handleStripeWebhook } = await import("./paynow");
    const rawBody = Buffer.from(JSON.stringify(checkoutCompletedEvent()));
    const stale = String(Math.floor(Date.now() / 1000) - 400);
    await expect(handleStripeWebhook(rawBody, signedHeaders(rawBody.toString("utf8"), stale))).rejects.toThrow(/timestamp/i);
    expect(purchasePriorityForUser).not.toHaveBeenCalled();
  });

  it("rejects a mismatched signing secret", async () => {
    const { handleStripeWebhook } = await import("./paynow");
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_other";
    const rawBody = Buffer.from(JSON.stringify(checkoutCompletedEvent()));
    await expect(handleStripeWebhook(rawBody, signedHeaders(rawBody.toString("utf8")))).rejects.toThrow(/signature/i);
  });
});
