import crypto from "node:crypto";
import {
  ensureMonthlyAllocationForUser,
  getOwnerIdForWhopMembership,
  recordWhopWebhookEvent,
  setWhopCheckoutConfigIdForUser,
  upsertSubscriptionForUser,
  type WhopSubscriptionState,
} from "./db";
import { PAID_PLAN_PRICE_CENTS, PAID_PLAN_CURRENCY } from "./credits";

/**
 * Whop billing integration: checkout creation and signed membership webhooks.
 *
 * The paid plan (Nova Pro, $7.99/month) lives on the deployment's Whop
 * business account. Checkout configurations carry `metadata.nova_user_id`,
 * which Whop copies onto the payments and memberships it creates, so the
 * membership webhooks can resolve the owning Nova account without any state
 * beyond the subscription row.
 *
 * Two credentials, both server-only:
 * - WHOP_API_KEY: a `whop_...` company API key (Whop dashboard > Developer),
 *   used to create checkout configurations.
 * - WHOP_WEBHOOK_SECRET: the `ws_...` signing secret of the webhook that
 *   posts membership events to /api/whop/webhook. Absent = webhooks off.
 *
 * WHOP_PLAN_ID pins checkout to an existing Whop plan (variant). Without it
 * checkout creates/reuses an inline $7.99 / 30-day renewal variant instead,
 * which is how a fresh deployment bootstraps itself.
 */

const WHOP_API_BASE_URL = "https://api.whop.com/api/v1";
/** Whop rejects a signature whose timestamp is more than this far from now. */
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export class WhopNotConfiguredError extends Error {
  constructor(message = "Nova's paid plan is not configured on this deployment yet.") {
    super(message);
    this.name = "WhopNotConfiguredError";
  }
}

function whopApiKey(): string | undefined {
  const key = process.env.WHOP_API_KEY?.trim();
  return key && key.length >= 8 ? key : undefined;
}

function whopWebhookSecret(): string | undefined {
  const secret = process.env.WHOP_WEBHOOK_SECRET?.trim();
  return secret && secret.length >= 8 ? secret : undefined;
}

/** True when checkout can be created (webhooks may still need their secret). */
export function isWhopConfigured(): boolean {
  return Boolean(whopApiKey());
}

/** Returns the plan ID if set in env, otherwise undefined (inline plan created). */
export function getWhopPlanId(): string | undefined {
  return process.env.WHOP_PLAN_ID?.trim();
}

/** Human-readable message when Whop is not configured. */
export function whopConfigurationMessage(): string {
  return "Nova Pro is not configured on this deployment. Contact the administrator to enable paid subscriptions.";
}

/** The monthly subscription price in whole major units, for the checkout body. */
const PAID_PLAN_PRICE = PAID_PLAN_PRICE_CENTS / 100;

type WhopCheckoutConfiguration = {
  id: string;
  purchase_url?: string | null;
};

type CreateWhopCheckoutInput = {
  ownerId: number;
  planId: string | undefined;
  redirectUrl: string | undefined;
};

type CreateWhopCheckoutOutput = {
  id: string;
  purchaseUrl: string;
};

/**
 * Creates a Whop checkout configuration for the owner's paid-plan purchase
 * and returns its hosted URL. The configuration is remembered on the
 * subscription row so support can trace a purchase back to it.
 */
export async function createWhopCheckout(input: CreateWhopCheckoutInput): Promise<CreateWhopCheckoutOutput> {
  const apiKey = whopApiKey();
  if (!apiKey) throw new WhopNotConfiguredError();
  const { ownerId, planId, redirectUrl } = input;
  const body: Record<string, unknown> = {
    mode: "payment",
    metadata: { nova_user_id: String(ownerId) },
    redirect_url: redirectUrl,
  };
  if (planId) {
    body.plan_id = planId;
  } else {
    body.plan = {
      plan_type: "renewal",
      billing_period: 30,
      currency: PAID_PLAN_CURRENCY,
      initial_price: PAID_PLAN_PRICE,
      renewal_price: PAID_PLAN_PRICE,
      title: "Nova Pro (monthly)",
      description: "10,000 Nova credits every month - unused credits carry over - plus access to premium models.",
    };
  }
  const response = await fetch(`${WHOP_API_BASE_URL}/checkout_configurations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error("[Whop] checkout configuration failed", response.status, detail);
    throw new WhopNotConfiguredError("Nova's billing provider could not create the checkout - please try again shortly.");
  }
  const configuration = (await response.json()) as WhopCheckoutConfiguration;
  const purchaseUrl = configuration.purchase_url ?? null;
  if (!configuration.id || !purchaseUrl) {
    console.error("[Whop] checkout configuration response missing id/purchase_url");
    throw new WhopNotConfiguredError("Nova's billing provider returned an unusable checkout - please try again shortly.");
  }
  await setWhopCheckoutConfigIdForUser(ownerId, configuration.id);
  return { id: configuration.id, purchaseUrl };
}

/* ------------------------------------------------------------------------- */
/* Webhook verification (Standard Webhooks spec, as Whop documents it)       */
/* ------------------------------------------------------------------------- */

export type VerifiedWhopEvent = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

function whopSigningKey(secret: string): Buffer {
  // Whop hands the secret as `ws_<base64>`; the Standard Webhooks spec signs
  // with the decoded bytes. A raw (unprefixed) secret is used as-is.
  const trimmed = secret.startsWith("ws_") ? secret.slice(3) : secret;
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length > 0 && decoded.toString("base64").replace(/=+$/, "") === trimmed.replace(/=+$/, "")) {
      return decoded;
    }
  } catch {
    // Fall through to the raw secret bytes.
  }
  return Buffer.from(secret, "utf8");
}

/**
 * Verifies the Standard Webhooks signature on a raw request body and returns
 * the parsed event. Throws when the secret is missing, the signature does not
 * match, or the timestamp is outside the replay window.
 */
export function verifyWhopWebhook(rawBody: Buffer, headers: { "webhook-id"?: string; "webhook-timestamp"?: string; "webhook-signature"?: string }): VerifiedWhopEvent {
  const secret = whopWebhookSecret();
  if (!secret) throw new WhopNotConfiguredError("Nova's billing webhooks are not configured on this deployment yet.");
  const webhookId = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];
  if (!webhookId || !timestamp || !signatureHeader) throw new Error("Missing Whop webhook headers.");
  const sentAtSeconds = Number(timestamp);
  if (!Number.isFinite(sentAtSeconds) || Math.abs(Date.now() / 1000 - sentAtSeconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    throw new Error("Whop webhook timestamp is outside the accepted window.");
  }
  const expected = crypto
    .createHmac("sha256", whopSigningKey(secret))
    .update(`${webhookId}.${timestamp}.${rawBody.toString("utf8")}`)
    .digest();
  const offered: Buffer[] = [];
  for (const part of signatureHeader.split(" ")) {
    if (!part.startsWith("v1,")) continue;
    const encoded = part.slice(3);
    if (!encoded) continue;
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length > 0) offered.push(decoded);
  }
  const matches = offered.some(candidate => candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected));
  if (!matches) throw new Error("Whop webhook signature verification failed.");
  const event = JSON.parse(rawBody.toString("utf8")) as { id?: string; type?: string; data?: Record<string, unknown> };
  if (!event.id || !event.type || !event.data) throw new Error("Whop webhook payload is malformed.");
  return { id: event.id, type: event.type, data: event.data };
}

/* ------------------------------------------------------------------------- */
/* Membership event handling                                                 */
/* ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return new Date(value * 1000);
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/** Whop membership statuses that should keep (or grant) the paid plan. */
const ACTIVE_MEMBERSHIP_STATUSES = new Set(["active", "trialing"]);

/**
 * Maps one membership webhook's data object onto the local subscription row.
 * `mem_` ids tie every later event back to the activation; `metadata` carries
 * the checkout's `nova_user_id` so the first event can resolve the owner.
 */
function membershipToState(data: Record<string, unknown>): { state: WhopSubscriptionState; membershipId: string | null; ownerIdFromMetadata: number | null } {
  const metadata = asRecord(data.metadata);
  const rawOwnerId = metadata?.nova_user_id;
  const ownerIdFromMetadata = typeof rawOwnerId === "string" || typeof rawOwnerId === "number" ? Number(rawOwnerId) : NaN;
  const status = typeof data.status === "string" ? data.status : "inactive";
  const periodEnd = asDate(data.current_period_end);
  const active = ACTIVE_MEMBERSHIP_STATUSES.has(status) && (periodEnd === null || periodEnd.getTime() > Date.now());
  return {
    state: {
      plan: active ? "paid" : "free",
      status,
      whopMembershipId: typeof data.id === "string" ? data.id : null,
      whopUserId: typeof data.user_id === "string" ? data.user_id : null,
      whopCheckoutConfigId: null,
      currentPeriodStart: asDate(data.current_period_start),
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    },
    membershipId: typeof data.id === "string" ? data.id : null,
    ownerIdFromMetadata: Number.isInteger(ownerIdFromMetadata) && ownerIdFromMetadata > 0 ? ownerIdFromMetadata : null,
  };
}

export type WhopWebhookOutcome =
  | { handled: true; ownerId: number; plan: "free" | "paid"; status: string }
  | { handled: false; reason: string };

/**
 * Verifies, dedupes, and applies one webhook delivery. Replayed deliveries
 * (same webhook-id) are acknowledged without re-applying so a flaky first
 * response never double-activates anything.
 */
export async function handleWhopWebhook(rawBody: Buffer, headers: Parameters<typeof verifyWhopWebhook>[1]): Promise<WhopWebhookOutcome> {
  const event = verifyWhopWebhook(rawBody, headers);
  if (!event.type.startsWith("membership.")) {
    return { handled: false, reason: `ignored-event:${event.type}` };
  }
  const membershipId = typeof event.data.id === "string" ? event.data.id : null;
  const firstDelivery = await recordWhopWebhookEvent(event.id, event.type, membershipId);
  if (!firstDelivery) return { handled: false, reason: "duplicate-delivery" };

  const { state, ownerIdFromMetadata } = membershipToState(event.data);
  let ownerId = ownerIdFromMetadata;
  if (ownerId === null && membershipId) {
    ownerId = await getOwnerIdForWhopMembership(membershipId);
  }
  if (ownerId === null) {
    // Not a Nova checkout (or one from before metadata existed) - keep the
    // delivery recorded so a retry does not loop, but change nothing.
    console.warn("[Whop] membership event with no resolvable Nova account", event.type, membershipId);
    return { handled: false, reason: "unknown-owner" };
  }

  const summary = await upsertSubscriptionForUser(ownerId, state);
  if (summary.plan === "paid") {
    await ensureMonthlyAllocationForUser(ownerId);
  }
  console.info(`[Whop] ${event.type}: account ${ownerId} -> ${summary.plan} (${summary.status})`);
  return { handled: true, ownerId, plan: summary.plan, status: summary.status };
}
