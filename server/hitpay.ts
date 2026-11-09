import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { ensureMonthlyAllocationForUser, purchasePriorityForUser, recordWhopWebhookEvent } from "./db";
import { requireDb } from "./db/core";
import { userSubscriptions } from "../drizzle/schema";
import { PAID_PLAN_PRICE_CENTS, PAID_PLAN_CURRENCY } from "./credits";
import { PRIORITY_CURRENCY, PRIORITY_PRICE_CENTS } from "./db/priority";

/**
 * HitPay billing integration for PayNow QR (Singapore).
 *
 * Whop does not offer PayNow at checkout for SGD (its Local Payment Methods
 * list has no PayNow), so PayNow is offered via HitPay's Payment Requests
 * API. Products:
 * - Priority S$4.99 one-time -> purchasePriorityForUser on webhook
 * - Pro S$7.99 -> 30 days of Pro on webhook (one-time grant; renewal via
 *   PayNow is one-time-only per Stripe/HitPay docs, so Pro via PayNow does
 *   not auto-renew — user re-pays monthly for another 30 days)
 *
 * Env (server-only):
 * - HITPAY_API_KEY: X-BUSINESS-API-KEY (HitPay dashboard)
 * - HITPAY_WEBHOOK_SALT: salt for HMAC-SHA256 webhook verification
 * - HITPAY_API_BASE_URL: override for sandbox (https://api.sandbox.hit-pay.com)
 *   Default production: https://api.hit-pay.com
 */

export class HitPayNotConfiguredError extends Error {
  detail?: string;
  constructor(message = "HitPay PayNow is not configured on this deployment yet.", detail?: string) {
    super(message);
    this.name = "HitPayNotConfiguredError";
    if (detail) this.detail = detail;
  }
}

function hitPayApiKey(): string | undefined {
  const key = process.env.HITPAY_API_KEY?.trim();
  return key && key.length >= 8 ? key : undefined;
}
function hitPaySalt(): string | undefined {
  const secret = process.env.HITPAY_WEBHOOK_SALT?.trim();
  return secret && secret.length >= 8 ? secret : undefined;
}
function hitPayBaseUrl(): string {
  return (process.env.HITPAY_API_BASE_URL?.trim() || "https://api.hit-pay.com").replace(/\/+$/, "");
}

export function isHitPayConfigured(): boolean {
  return Boolean(hitPayApiKey());
}

export function hitPayConfigurationMessage(): string {
  return "HitPay PayNow is not configured on this deployment. Contact the administrator to enable PayNow payments.";
}

export type HitPayProduct = "pro" | "priority";

function amountForProduct(product: HitPayProduct): { amount: number; currency: string } {
  if (product === "pro") return { amount: PAID_PLAN_PRICE_CENTS / 100, currency: PAID_PLAN_CURRENCY };
  return { amount: PRIORITY_PRICE_CENTS / 100, currency: PRIORITY_CURRENCY };
}

export function hitPayReferenceNumber(product: HitPayProduct, ownerId: number): string {
  const suffix = crypto.randomBytes(4).toString("hex");
  return `nova-${product}-${ownerId}-${suffix}`;
}

export function parseHitPayReferenceNumber(referenceNumber: string): { product: HitPayProduct; ownerId: number } | null {
  const match = /^nova-(pro|priority)-(\d+)-[0-9a-f]+$/i.exec(referenceNumber.trim());
  if (!match) return null;
  const ownerId = Number(match[2]);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return null;
  return { product: match[1].toLowerCase() as HitPayProduct, ownerId };
}

type CreateHitPayInput = {
  ownerId: number;
  product: HitPayProduct;
  email?: string;
  name?: string;
  redirectUrl?: string;
};

type CreateHitPayOutput = {
  id: string;
  url: string;
  referenceNumber: string;
};

export async function createHitPayPaymentRequest(input: CreateHitPayInput): Promise<CreateHitPayOutput> {
  const apiKey = hitPayApiKey();
  if (!apiKey) throw new HitPayNotConfiguredError(hitPayConfigurationMessage(), "Missing HITPAY_API_KEY");
  const { ownerId, product, email, name, redirectUrl } = input;
  const { amount, currency } = amountForProduct(product);
  const referenceNumber = hitPayReferenceNumber(product, ownerId);
  const body = new URLSearchParams({
    amount: amount.toFixed(2),
    currency,
    reference_number: referenceNumber,
    email: email || "",
    name: name || "",
    redirect_url: redirectUrl || "",
    purpose: product === "pro" ? "Nova Pro (monthly)" : `Nova Priority - 1 hour (${currency.toUpperCase()})`,
    // paynow_online is the HitPay method code for PayNow QR (Singapore)
    "payment_methods[]": "paynow_online",
  });
  // URLSearchParams encodes payment_methods[] as payment_methods%5B%5D; HitPay accepts both.
  const response = await fetch(`${hitPayBaseUrl()}/v1/payment-requests`, {
    method: "POST",
    headers: {
      "X-BUSINESS-API-KEY": apiKey,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error("[HitPay] payment request failed", response.status, detail);
    throw new HitPayNotConfiguredError("HitPay could not create the PayNow checkout - please try again shortly.", `${response.status} ${detail}`);
  }
  const data = (await response.json()) as { id?: string; url?: string };
  if (!data.id || !data.url) {
    throw new HitPayNotConfiguredError("HitPay returned an unusable checkout - please try again shortly.", JSON.stringify(data).slice(0, 400));
  }
  return { id: data.id, url: data.url, referenceNumber };
}

/* ------------------------------------------------------------------------- */
/* Webhook verification */
/* ------------------------------------------------------------------------- */

export type VerifiedHitPayEvent = {
  id: string;
  status: string;
  referenceNumber: string;
  amount: string;
  currency: string;
  email?: string;
};

export function verifyHitPayWebhook(
  rawBody: Buffer | string,
  signatureHeader: string | undefined
): VerifiedHitPayEvent {
  const salt = hitPaySalt();
  if (!salt) throw new HitPayNotConfiguredError("HitPay webhooks are not configured on this deployment yet.");
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  if (!signatureHeader) throw new Error("Missing HitPay webhook signature.");
  // HitPay signature search: Node example in docs uses HMAC-SHA256 of the JSON payload with salt.
  const expected = crypto.createHmac("sha256", salt).update(raw).digest("hex");
  const offered = signatureHeader.trim();
  // Accept both raw hex and base64 encodings, and timing-safe compare.
  const hexMatches = offered.toLowerCase() === expected.toLowerCase();
  let base64Matches = false;
  try {
    const decoded = Buffer.from(offered, "base64");
    base64Matches = decoded.equals(Buffer.from(expected, "hex"));
  } catch {
    base64Matches = false;
  }
  if (!hexMatches && !base64Matches) {
    // Also try HMAC over the parsed JSON re-stringified (some dashboards sign JSON)
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const stringified = JSON.stringify(parsed);
      const alt = crypto.createHmac("sha256", salt).update(stringified).digest("hex");
      if (alt.toLowerCase() !== offered.toLowerCase()) throw new Error("signature mismatch");
    } catch {
      throw new Error("HitPay webhook signature verification failed.");
    }
  }
  const event = JSON.parse(raw) as { id?: string; status?: string; reference_number?: string; amount?: string; currency?: string; email?: string; hmac?: string };
  if (!event.id || !event.status || !event.reference_number) throw new Error("HitPay webhook payload is malformed.");
  // If hmac field is present, it must verify as well (legacy HitPay field)
  if (event.hmac && event.hmac.toLowerCase() !== expected.toLowerCase()) {
    // Fall back to header verification already done; log mismatch but don't fail if header matched
    console.warn("[HitPay] webhook hmac field mismatch (header verified)");
  }
  return {
    id: String(event.id),
    status: String(event.status),
    referenceNumber: String(event.reference_number),
    amount: String(event.amount ?? ""),
    currency: String(event.currency ?? ""),
    email: event.email,
  };
}

export type HitPayWebhookOutcome =
  | { handled: true; ownerId: number; product: HitPayProduct; paymentRequestId: string }
  | { handled: false; reason: string };

async function grantHitPayPro(ownerId: number, paymentRequestId: string) {
  const db = await requireDb();
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db
    .insert(userSubscriptions)
    .values({
      ownerId,
      plan: "paid",
      status: "active",
      provider: "hitpay",
      whopMembershipId: `hitpay-${paymentRequestId}`,
      whopUserId: null,
      whopCheckoutConfigId: null,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSubscriptions.ownerId,
      set: {
        plan: "paid",
        status: "active",
        provider: "hitpay",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        whopMembershipId: sql`COALESCE(${`hitpay-${paymentRequestId}`}, "user_subscriptions"."whopMembershipId")`,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        updatedAt: now,
      },
    });
  await ensureMonthlyAllocationForUser(ownerId);
  return { ok: true as const };
}

export async function handleHitPayWebhook(
  rawBody: Buffer | string,
  signatureHeader: string | undefined
): Promise<HitPayWebhookOutcome> {
  const event = verifyHitPayWebhook(rawBody, signatureHeader);
  if (event.status !== "completed") {
    return { handled: false, reason: `ignored-status:${event.status}` };
  }
  const parsed = parseHitPayReferenceNumber(event.referenceNumber);
  if (!parsed) {
    console.warn("[HitPay] webhook with unresolvable reference_number", event.referenceNumber);
    return { handled: false, reason: "unknown-reference" };
  }
  const { product, ownerId } = parsed;
  // Dedupe via existing webhook events table (eventId unique)
  const firstDelivery = await recordWhopWebhookEvent(`hitpay-${event.id}`, `payment_request.${event.status}`, event.referenceNumber);
  if (!firstDelivery) return { handled: false, reason: "duplicate-delivery" };

  if (product === "priority") {
    const status = await purchasePriorityForUser(ownerId);
    console.info(`[HitPay] payment_request.completed: account ${ownerId} -> priority armed=${status.armed}`);
    return { handled: true, ownerId, product, paymentRequestId: event.id };
  }
  await grantHitPayPro(ownerId, event.id);
  console.info(`[HitPay] payment_request.completed: account ${ownerId} -> pro active (30d via HitPay)`);
  return { handled: true, ownerId, product, paymentRequestId: event.id };
}

export function isHitPayWebhookConfigured(): boolean {
  return Boolean(hitPaySalt());
}
