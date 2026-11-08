import crypto from "node:crypto";
import { purchasePriorityForUser, recordWhopWebhookEvent } from "./db";
import { PRIORITY_CURRENCY, PRIORITY_PRICE_CENTS } from "./db/priority";

/**
 * PayNow checkout (PayNow/PayLah QR) via Stripe.
 *
 * Stripe supports PayNow for one-time payments only, so this covers the
 * one-time priority purchase; the Nova Pro subscription stays on Whop. The
 * Stripe hosted checkout page renders the PayNow QR that any Singapore
 * banking app (PayNow, PayLah, or the bank's own app) can scan, and confirms
 * payment through a webhook - priority is armed only there, never here.
 */

const STRIPE_API_BASE_URL = process.env.STRIPE_API_BASE_URL?.trim() || "https://api.stripe.com/v1";

/** Webhook timestamps older than this are rejected (Stripe's own tolerance). */
const WEBHOOK_TOLERANCE_SECONDS = 300;

export class PayNowNotConfiguredError extends Error {
  constructor(readonly detail?: string) {
    super("PayNow checkout is not configured");
    this.name = "PayNowNotConfiguredError";
  }
}

/** Whether a Stripe secret key is present, which is all PayNow checkout needs. */
export function isPayNowConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return Boolean(key && key.startsWith("sk_"));
}

export function payNowConfigurationMessage(): string {
  return "PayNow checkout is not set up on this Nova deployment. Add STRIPE_SECRET_KEY (a Singapore Stripe account with PayNow enabled) to enable it, or use the standard checkout instead.";
}

/** The app URL the hosted checkout returns the browser to after payment. */
function defaultRedirectUrl(): string {
  return (process.env.NOVA_WEB_APP_URL?.trim() || "https://novacloud.computer") + "/";
}

function withPriorityOutcome(url: string, outcome: "success" | "cancelled"): string {
  const parsed = new URL(url);
  parsed.searchParams.set("priority", outcome);
  return parsed.toString();
}

/**
 * Opens a Stripe Checkout session that shows the PayNow QR code. The caller
 * (billing.purchasePriorityPayNow) has already checked priority availability;
 * this only talks to Stripe.
 */
export async function createPayNowPriorityCheckout(params: {
  ownerId: number;
  redirectUrl?: string;
}): Promise<{ id: string; url: string }> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new PayNowNotConfiguredError("STRIPE_SECRET_KEY is not set");
  const base = params.redirectUrl?.trim() || defaultRedirectUrl();

  const body = new URLSearchParams({
    mode: "payment",
    // PayNow is QR-only: Stripe renders the code the buyer scans in their
    // Singapore banking app (PayNow, PayLah, or the bank's own app).
    "payment_method_types[0]": "paynow",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": PRIORITY_CURRENCY,
    "line_items[0][price_data][unit_amount]": String(PRIORITY_PRICE_CENTS),
    "line_items[0][price_data][product_data][name]": "1 hour of priority queue placement",
    "metadata[nova_product]": "priority",
    "metadata[nova_user_id]": String(params.ownerId),
    "metadata[nova_priority_hours]": "1",
    success_url: withPriorityOutcome(base, "success"),
    cancel_url: withPriorityOutcome(base, "cancelled"),
  });

  const response = await fetch(`${STRIPE_API_BASE_URL}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = (await response.json()) as { id?: string; url?: string | null; error?: { message?: string } };
  if (!response.ok || !payload.id || !payload.url) {
    throw new Error(`Stripe checkout session failed (${response.status}): ${payload.error?.message ?? response.statusText}`);
  }
  return { id: payload.id, url: payload.url };
}

/**
 * Verifies a Stripe webhook delivery (the `Stripe-Signature` header scheme:
 * HMAC-SHA256 over `${timestamp}.${rawBody}`, hex-encoded) and returns the
 * parsed event. Throws on any signature, timestamp, or payload problem so the
 * route can answer 400 and Stripe retries with fresh signatures.
 */
export function verifyStripeWebhook(
  rawBody: Buffer,
  headers: { "stripe-signature"?: string },
  secret: string,
): { id: string; type: string; data: { object: Record<string, unknown> } } {
  if (!secret) throw new Error("Stripe webhook signing secret is not configured");
  const header = headers["stripe-signature"];
  if (!header) throw new Error("Missing Stripe-Signature header");

  const parts = new Map<string, string[]>();
  for (const segment of header.split(",")) {
    const [name, ...rest] = segment.split("=");
    if (!name || rest.length === 0) continue;
    const list = parts.get(name.trim()) ?? [];
    list.push(rest.join("=").trim());
    parts.set(name.trim(), list);
  }
  const timestamp = parts.get("t")?.[0];
  const signatures = parts.get("v1") ?? [];
  if (!timestamp || signatures.length === 0) throw new Error("Malformed Stripe-Signature header");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > WEBHOOK_TOLERANCE_SECONDS) throw new Error("Timestamp is outside the tolerance window");

  const expected = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const matched = signatures.some(signature => {
    const provided = Buffer.from(signature, "hex");
    return provided.length === expectedBytes.length && crypto.timingSafeEqual(provided, expectedBytes);
  });
  if (!matched) throw new Error("Stripe webhook signature verification failed");

  try {
    const event = JSON.parse(rawBody.toString("utf8")) as { id: string; type: string; data: { object: Record<string, unknown> } };
    if (!event?.id || !event?.type) throw new Error("missing id/type");
    return event;
  } catch {
    throw new Error("Stripe webhook payload is malformed");
  }
}

export type PayNowWebhookOutcome = {
  priorityArmed: boolean;
  subscriptionUpdated: boolean;
  ownerId: number | null;
  skipped?: string;
};

/**
 * Applies a verified webhook delivery. Only `checkout.session.completed` for
 * the one-time priority product matters; anything else is acknowledged without
 * acting. Deduplication keys on the Stripe event id so Stripe's automatic
 * retries cannot arm the same purchase twice.
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  headers: { "stripe-signature"?: string },
): Promise<{ type: string } & PayNowWebhookOutcome> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const event = verifyStripeWebhook(rawBody, headers, secret);
  const outcome: PayNowWebhookOutcome = { priorityArmed: false, subscriptionUpdated: false, ownerId: null };

  if (event.type !== "checkout.session.completed") {
    return { type: event.type, ...outcome, skipped: "unhandled-event" };
  }

  const session = event.data.object;
  const metadata = (session.metadata ?? {}) as Record<string, string>;
  if (metadata.nova_product !== "priority") {
    return { type: event.type, ...outcome, skipped: "not-nova-product" };
  }
  if (session.payment_status && session.payment_status !== "paid") {
    return { type: event.type, ...outcome, skipped: `payment_status=${session.payment_status}` };
  }
  const ownerId = Number(metadata.nova_user_id);
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    return { type: event.type, ...outcome, skipped: "unknown-owner" };
  }
  outcome.ownerId = ownerId;

  // The events table is billing-wide dedupe storage; the `stripe:` prefix
  // keeps these ids in their own namespace alongside Whop event ids.
  const firstDelivery = await recordWhopWebhookEvent(`stripe:${event.id}`, event.type, String(session.id ?? "").slice(0, 64) || null);
  if (!firstDelivery) {
    return { type: event.type, ...outcome, skipped: "duplicate-event" };
  }

  await purchasePriorityForUser(ownerId);
  return { type: event.type, priorityArmed: true, subscriptionUpdated: false, ownerId };
}
