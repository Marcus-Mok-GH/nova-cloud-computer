import { beforeEach, describe, expect, it, vi } from "vitest";

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
const setWhopCheckoutConfigIdForUser = vi.fn(async () => undefined);

vi.mock("./db", () => ({
  purchasePriorityForUser,
  recordWhopWebhookEvent,
  upsertSubscriptionForUser,
  ensureMonthlyAllocationForUser,
  getOwnerIdForWhopMembership,
  setWhopCheckoutConfigIdForUser,
}));

describe("Whop priority webhooks", () => {
  beforeEach(() => {
    purchasePriorityForUser.mockClear();
    recordWhopWebhookEvent.mockClear();
    upsertSubscriptionForUser.mockClear();
    ensureMonthlyAllocationForUser.mockClear();
    process.env.WHOP_WEBHOOK_SECRET = "ws_dGVzdC1zZWNyZXQ";
    process.env.WHOP_PRIORITY_PLAN_ID = "plan_BFyuf6PmE5wwz";
    process.env.WHOP_PLAN_ID = "plan_qndYktNv5y8lg";
    vi.resetModules();
  });

  async function signedRequest(event: { id: string; type: string; data: Record<string, unknown> }) {
    const { verifyWhopWebhook, handleWhopWebhook } = await import("./whop");
    const rawBody = Buffer.from(JSON.stringify(event));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const webhookId = `msg_${event.id}`;
    // Call verify first so the test fails clearly if signing helpers change.
    const secret = process.env.WHOP_WEBHOOK_SECRET!;
    const crypto = await import("node:crypto");
    const key = Buffer.from(secret, "utf8");
    const signature = crypto.createHmac("sha256", key).update(`${webhookId}.${timestamp}.${rawBody.toString("utf8")}`).digest("base64");
    const headers = {
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    };
    expect(verifyWhopWebhook(rawBody, headers).type).toBe(event.type);
    return handleWhopWebhook(rawBody, headers);
  }

  it("arms priority on payment.succeeded for the priority plan", async () => {
    const outcome = await signedRequest({
      id: "evt_priority_pay",
      type: "payment.succeeded",
      data: {
        id: "pay_priority_1",
        metadata: { nova_user_id: "42", nova_product: "priority" },
        plan: { id: "plan_BFyuf6PmE5wwz" },
      },
    });
    expect(outcome).toEqual({ handled: true, ownerId: 42, product: "priority", armed: true });
    expect(purchasePriorityForUser).toHaveBeenCalledWith(42);
    expect(upsertSubscriptionForUser).not.toHaveBeenCalled();
  });

  it("does not grant Nova Pro when a priority membership activates", async () => {
    const outcome = await signedRequest({
      id: "evt_priority_mem",
      type: "membership.activated",
      data: {
        id: "mem_priority_1",
        status: "active",
        metadata: { nova_user_id: "7", nova_product: "priority" },
        plan: { id: "plan_BFyuf6PmE5wwz" },
      },
    });
    expect(outcome).toEqual({ handled: true, ownerId: 7, product: "priority", armed: true });
    expect(purchasePriorityForUser).toHaveBeenCalledWith(7);
    expect(upsertSubscriptionForUser).not.toHaveBeenCalled();
  });

  it("ignores duplicate priority deliveries", async () => {
    recordWhopWebhookEvent.mockResolvedValueOnce(false);
    const outcome = await signedRequest({
      id: "evt_priority_dup",
      type: "payment.succeeded",
      data: {
        id: "pay_priority_dup",
        metadata: { nova_user_id: "9", nova_product: "priority" },
        plan: { id: "plan_BFyuf6PmE5wwz" },
      },
    });
    expect(outcome).toEqual({ handled: false, reason: "duplicate-delivery" });
    expect(purchasePriorityForUser).not.toHaveBeenCalled();
  });
});
