import crypto from "node:crypto";
import {
  getOwnerIdForWhopMembership,
  grantCreditTopUp,
  purchasePriorityForUser,
  recordWhopWebhookEvent,
  setWhopCheckoutConfigIdForUser,
  upsertSubscriptionForUser,
  type WhopSubscriptionState,
} from "./db";
import {
  PAID_PLAN_CURRENCY,
  PAID_PLAN_PRICE_CENTS,
  PLUS_PLAN_PRICE_CENTS,
  type PlanTier,
} from "./credits";
import { PRIORITY_CURRENCY, PRIORITY_PRICE_CENTS } from "./db/priority";
import {
  CREDIT_TOPUP_CURRENCY,
  CREDIT_TOPUP_PRODUCT_MARKER,
  getCreditTopUpProduct,
  type CreditTopUpProduct,
} from "@shared/creditTopUps";

/**
 * Whop billing integration: checkout creation and signed payment/membership webhooks.
 *
 * Nova Pro (S$7.99/month) and one-hour priority (S$4.99 one-time) both live on
 * the deployment's Whop business. Checkout configurations carry
 * `metadata.nova_user_id` (and `nova_product` for priority), which Whop copies
 * onto the payments and memberships it creates so webhooks can resolve the
 * owning Nova account. Apple Pay is enabled on the **variants**
 * themselves
 * (`variant_id`s in Whop carry the payment method config) — checkout-level
 * `payment_method_configuration` only works in setup mode per Whop docs and
 * causes 400 errors in payment mode, so we rely on the variant.
 *
 * Two credentials, both server-only:
 * - WHOP_API_KEY: a `whop_...` company API key (Whop dashboard > Developer),
 *   used to create checkout configurations.
 * - WHOP_ACCOUNT_ID: the `biz_...` account the key belongs to (Nova Labs is
 *   biz_x7eTBFTmhOxbVs). The raw REST API requires it on every
 *   checkout_configurations call; the Whop SDK fills it in from the key,
 *   which is why the SDK-based scripts/create-whop-*.ts never had to name it.
 * - WHOP_WEBHOOK_SECRET: the ws_... signing secret of the webhook that
 *   posts events to /api/whop/webhook. Absent = webhooks off.
 *
 * WHOP_PLAN_ID pins Pro checkout to an existing Whop plan (variant). Without it
 * checkout creates/reuses an inline S$7.99 / 30-day renewal variant instead.
 * WHOP_PRIORITY_PLAN_ID pins priority checkout to the S$4.99 one-time plan.
 * WHOP_CREDIT_PLAN_IDS pins the credit top-up ladder: a JSON object mapping a
 * catalog slug to its `plan_` id (`{"topup-10":"plan_..."}`). Pinned, the
 * credit checkout references the variant instead of creating one inline -
 * production company API keys are not authorized to create variants inline
 * (Whop answers 403 "not authorized"), so the rungs live in the Whop account
 * and the checkout just references them, exactly like Pro/Priority. Without
 * the map, the inline-variant fallback keeps dev environments working.
 */

const WHOP_API_BASE_URL = "https://api.whop.com/api/v1";
/**
 * Pinned API version for checkout creation. Whop versions by date; the
 * `variant` / `variant_id` schema is the current (2026) shape, while the
 * legacy 2025-01-01 shape expected `plan` / `plan_id`.
 */
const WHOP_API_VERSION_DATE = "2026-07-23";
/** Whop rejects a signature whose timestamp is more than this far from now. */
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export class WhopNotConfiguredError extends Error {
  detail?: string;
  constructor(
    message = "Nova's paid plan is not configured on this deployment yet.",
    detail?: string
  ) {
    super(message);
    this.name = "WhopNotConfiguredError";
    if (detail) this.detail = detail;
  }
}

/**
 * When true, checkout procedures surface the raw Whop API error to the client
 * so a failing checkout can be pinpointed from the UI/toast and Vercel logs.
 * Set WHOP_CHECKOUT_DEBUG=true on the deployment to enable; off by default.
 */
export function isWhopCheckoutDebug(): boolean {
  const v = process.env.WHOP_CHECKOUT_DEBUG?.trim().toLowerCase();
  return v === "true" || v === "1";
}

function whopApiKey(): string | undefined {
  const key = process.env.WHOP_API_KEY?.trim();
  return key && key.length >= 8 ? key : undefined;
}

function whopAccountId(): string | undefined {
  const id = process.env.WHOP_ACCOUNT_ID?.trim();
  return id && id.length >= 8 ? id : undefined;
}

function whopWebhookSecret(): string | undefined {
  const secret = process.env.WHOP_WEBHOOK_SECRET?.trim();
  return secret && secret.length >= 8 ? secret : undefined;
}

/** True when the API key is set (webhook-only deployments may skip account_id). */
export function isWhopConfigured(): boolean {
  return Boolean(whopApiKey());
}

/** Returns the plan ID if set in env, otherwise undefined (inline plan created). */
export function getWhopPlanId(): string | undefined {
  return process.env.WHOP_PLAN_ID?.trim();
}

/** Returns the Plus plan ID if set in env, otherwise undefined (inline plan created). */
export function getWhopPlusPlanId(): string | undefined {
  return process.env.WHOP_PLUS_PLAN_ID?.trim();
}

/** Returns the one-time priority plan ID if set in env. */
export function getWhopPriorityPlanId(): string | undefined {
  return process.env.WHOP_PRIORITY_PLAN_ID?.trim();
}

/**
 * The pinned credit top-up variants: `WHOP_CREDIT_PLAN_IDS` is a JSON object
 * mapping a catalog slug to its `plan_` id, e.g.
 * `{"topup-10":"plan_..."}`. Returns undefined when the variable is unset or
 * unparseable, so those deployments keep the inline-variant fallback.
 */
export function getWhopCreditPlanIds(): Record<string, string> | undefined {
  const raw = process.env.WHOP_CREDIT_PLAN_IDS?.trim();
  if (!raw) return undefined;
  const candidates = [raw];
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    candidates.push(raw.slice(1, -1).trim());
  }
  for (const candidate of [...candidates]) {
    if (candidate.includes('\\"')) {
      candidates.push(candidate.replace(/\\"/g, '"'));
    }
  }
  let parsed: unknown;
  let parsedOk = false;
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      parsed = typeof value === "string" ? JSON.parse(value) : value;
      parsedOk = true;
      break;
    } catch {
      // try next candidate normalization
    }
  }
  if (!parsedOk) {
    console.warn(
      "[Whop] WHOP_CREDIT_PLAN_IDS is set but could not be parsed as JSON"
    );
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const ids: Record<string, string> = {};
  for (const [slug, value] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (typeof value === "string" && value.trim()) ids[slug] = value.trim();
  }
  return Object.keys(ids).length > 0 ? ids : undefined;
}

/** Which Nova tier a membership's Whop plan ID buys. Plus is pinned by env;
 * anything else is Pro (the pinned Pro variant, or an inline checkout). */
function membershipPlanTier(data: Record<string, unknown>): PlanTier {
  const planId = planIdFromPayload(data);
  if (planId && getWhopPlusPlanId() && planId === getWhopPlusPlanId())
    return "plus";
  return "paid";
}

/** Human-readable message when Whop is not configured. */
export function whopConfigurationMessage(): string {
  return "Nova Pro is not configured on this deployment. Contact the administrator to enable paid subscriptions.";
}

function whopMissingConfigDetail(): string {
  const missing = !whopApiKey() ? "WHOP_API_KEY" : "WHOP_ACCOUNT_ID";
  return `Missing ${missing} on this deployment.`;
}

/** Human-readable message when priority checkout is not configured. */
export function whopPriorityConfigurationMessage(): string {
  return "Priority purchases are not configured on this deployment yet. Contact the administrator to enable them.";
}

export function whopCreditTopUpConfigurationMessage(): string {
  return "Credit top-ups are not available on this deployment yet. Contact the administrator to enable them.";
}

/** The monthly subscription price in whole major units, for the checkout body. */
const PAID_PLAN_PRICE = PAID_PLAN_PRICE_CENTS / 100;

/** The Plus subscription price in whole major units, for the inline variant. */
const PLUS_PLAN_PRICE = PLUS_PLAN_PRICE_CENTS / 100;

/** The one-time priority price in whole major units, for documentation/checkout bodies. */
const PRIORITY_PLAN_PRICE = PRIORITY_PRICE_CENTS / 100;

type WhopCheckoutConfiguration = {
  id: string;
  purchase_url?: string | null;
};

type CreateWhopCheckoutInput = {
  ownerId: number;
  plan: "pro" | "plus";
  planId: string | undefined;
  redirectUrl: string | undefined;
};

type CreateWhopCheckoutOutput = {
  id: string;
  purchaseUrl: string;
};

/** Apple Pay is enabled on both checkouts; platform defaults keep cards and other standard methods. */
const VARIANT_PAYMENT_METHOD_CONFIGURATION = {
  enabled: ["apple_pay"],
  disabled: [],
  include_platform_defaults: true,
} as const;

/**
 * Creates a Whop checkout configuration for the owner’s paid-plan purchase
 * and returns its hosted URL. The configuration is remembered on the
 * subscription row so support can trace a purchase back to it.
 */
export async function createWhopCheckout(
  input: CreateWhopCheckoutInput
): Promise<CreateWhopCheckoutOutput> {
  const apiKey = whopApiKey();
  const accountId = whopAccountId();
  if (!apiKey || !accountId)
    throw new WhopNotConfiguredError(
      whopConfigurationMessage(),
      whopMissingConfigDetail()
    );
  const { ownerId, plan, planId, redirectUrl } = input;
  const isPlus = plan === "plus";
  const planPrice = isPlus ? PLUS_PLAN_PRICE : PAID_PLAN_PRICE;
  const body: Record<string, unknown> = {
    account_id: accountId,
    mode: "payment",
    metadata: { nova_user_id: String(ownerId) },
    redirect_url: redirectUrl,
  };
  if (planId) {
    body.variant_id = planId;
  } else {
    body.variant = {
      billing_type: "renewal",
      billing_period: 30,
      currency: PAID_PLAN_CURRENCY,
      initial_price: planPrice,
      renewal_price: planPrice,
      title: isPlus ? "Nova Plus (monthly)" : "Nova Pro (monthly)",
      description: isPlus
        ? "5,000 Nova credits every day."
        : "10,000 Nova credits every day - plus access to premium models.",
      payment_method_configuration: VARIANT_PAYMENT_METHOD_CONFIGURATION,
    };
  }
  const response = await fetch(`${WHOP_API_BASE_URL}/checkout_configurations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Api-Version-Date": WHOP_API_VERSION_DATE,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error(
      "[Whop] checkout configuration failed",
      response.status,
      detail
    );
    throw new WhopNotConfiguredError(
      "Nova's billing provider could not create the checkout - please try again shortly.",
      `${response.status} ${detail}`
    );
  }
  const configuration = (await response.json()) as WhopCheckoutConfiguration;
  const purchaseUrl = configuration.purchase_url ?? null;
  if (!configuration.id || !purchaseUrl) {
    const detail = JSON.stringify(configuration).slice(0, 400);
    console.error(
      "[Whop] checkout configuration response missing id/purchase_url",
      detail
    );
    throw new WhopNotConfiguredError(
      "Nova's billing provider returned an unusable checkout - please try again shortly.",
      `missing id/purchase_url: ${detail}`
    );
  }
  await setWhopCheckoutConfigIdForUser(ownerId, configuration.id);
  return { id: configuration.id, purchaseUrl };
}

type CreateWhopCreditTopUpCheckoutInput = {
  ownerId: number;
  product: CreditTopUpProduct;
  redirectUrl: string | undefined;
};

/**
 * Creates a Whop checkout for a one-time credit bundle.
 *
 * When the bundle's tier is pinned (`WHOP_CREDIT_PLAN_IDS` maps its catalog
 * slug to a `plan_` id) the checkout references that existing variant via
 * `variant_id` - the same shape Pro and Priority use. That path works with the
 * production company API key, which is authorized to reference a variant but
 * not to create one inline. Without a pinned id the checkout falls back to
 * building an inline one-time variant from the shared catalog (dev setups).
 *
 * The credit amount travels in the metadata either way and is re-validated
 * against the catalog when the webhook lands. Credits are granted only then -
 * never at checkout creation.
 */
export async function createWhopCreditTopUpCheckout(
  input: CreateWhopCreditTopUpCheckoutInput
): Promise<CreateWhopCheckoutOutput> {
  const apiKey = whopApiKey();
  const accountId = whopAccountId();
  if (!apiKey || !accountId)
    throw new WhopNotConfiguredError(
      whopCreditTopUpConfigurationMessage(),
      whopMissingConfigDetail()
    );
  const { ownerId, product, redirectUrl } = input;
  const price = (product.priceCents / 100).toFixed(2);
  const body: Record<string, unknown> = {
    account_id: accountId,
    mode: "payment",
    metadata: {
      nova_user_id: String(ownerId),
      nova_product: CREDIT_TOPUP_PRODUCT_MARKER,
      nova_credit_product_id: product.id,
      nova_credit_amount: String(product.credits),
    },
    redirect_url: redirectUrl,
  };
  const pinnedPlanId = getWhopCreditPlanIds()?.[product.id];
  if (pinnedPlanId) {
    // Reference the pinned variant instead of creating one inline: the
    // production company key cannot create variants, so a new rung needs a
    // pinned id rather than inline creation.
    body.variant_id = pinnedPlanId;
  } else {
    body.variant = {
      billing_type: "one_time",
      currency: CREDIT_TOPUP_CURRENCY,
      initial_price: Number(price),
      title: `Nova credits (${product.credits.toLocaleString("en-US")})`,
      description: `${product.credits.toLocaleString("en-US")} Nova credits, added to your balance.`,
      payment_method_configuration: VARIANT_PAYMENT_METHOD_CONFIGURATION,
    };
  }
  const response = await fetch(`${WHOP_API_BASE_URL}/checkout_configurations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Api-Version-Date": WHOP_API_VERSION_DATE,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error(
      "[Whop] credit top-up checkout configuration failed",
      response.status,
      detail
    );
    throw new WhopNotConfiguredError(
      "Nova's billing provider could not create the checkout - please try again shortly.",
      `${response.status} ${detail}`
    );
  }
  const configuration = (await response.json()) as WhopCheckoutConfiguration;
  const purchaseUrl = configuration.purchase_url ?? null;
  if (!configuration.id || !purchaseUrl) {
    const detail = JSON.stringify(configuration).slice(0, 400);
    console.error(
      "[Whop] credit top-up checkout response missing id/purchase_url",
      detail
    );
    throw new WhopNotConfiguredError(
      "Nova's billing provider returned an unusable checkout - please try again shortly.",
      `missing id/purchase_url: ${detail}`
    );
  }
  return { id: configuration.id, purchaseUrl };
}

type CreateWhopPriorityCheckoutInput = {
  ownerId: number;
  planId: string;
  redirectUrl: string | undefined;
};

/**
 * Creates a Whop checkout configuration for one hour of priority (S$4.99 SGD
 * one-time). Priority is armed only when `payment.succeeded` arrives — never
 * at checkout creation.
 */
export async function createWhopPriorityCheckout(
  input: CreateWhopPriorityCheckoutInput
): Promise<CreateWhopCheckoutOutput> {
  const apiKey = whopApiKey();
  const accountId = whopAccountId();
  if (!apiKey || !accountId)
    throw new WhopNotConfiguredError(
      whopPriorityConfigurationMessage(),
      whopMissingConfigDetail()
    );
  const { ownerId, planId, redirectUrl } = input;
  if (!planId)
    throw new WhopNotConfiguredError(whopPriorityConfigurationMessage());
  const body: Record<string, unknown> = {
    account_id: accountId,
    mode: "payment",
    variant_id: planId,
    metadata: {
      nova_user_id: String(ownerId),
      nova_product: "priority",
      nova_priority_hours: "1",
      nova_priority_price: String(PRIORITY_PLAN_PRICE),
      nova_priority_currency: PRIORITY_CURRENCY,
    },
    redirect_url: redirectUrl,
  };
  const response = await fetch(`${WHOP_API_BASE_URL}/checkout_configurations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Api-Version-Date": WHOP_API_VERSION_DATE,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    console.error(
      "[Whop] priority checkout configuration failed",
      response.status,
      detail
    );
    throw new WhopNotConfiguredError(
      "Nova's billing provider could not create the priority checkout - please try again shortly.",
      `${response.status} ${detail}`
    );
  }
  const configuration = (await response.json()) as WhopCheckoutConfiguration;
  const purchaseUrl = configuration.purchase_url ?? null;
  if (!configuration.id || !purchaseUrl) {
    const detail = JSON.stringify(configuration).slice(0, 400);
    console.error(
      "[Whop] priority checkout configuration response missing id/purchase_url",
      detail
    );
    throw new WhopNotConfiguredError(
      "Nova's billing provider returned an unusable priority checkout - please try again shortly.",
      `missing id/purchase_url: ${detail}`
    );
  }
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
  // Whop HMACs with the literal UTF-8 bytes of the issued `ws_...` secret
  // (prefix included). Their SDK base64-encodes that string before handing it
  // to `standardwebhooks` so the library's decode yields these same bytes —
  // stripping `ws_` and base64-decoding here derives the wrong key.
  return Buffer.from(secret, "utf8");
}

/**
 * Verifies the Standard Webhooks signature on a raw request body and returns
 * the parsed event. Throws when the secret is missing, the signature does not
 * match, or the timestamp is outside the replay window.
 */
export function verifyWhopWebhook(
  rawBody: Buffer,
  headers: {
    "webhook-id"?: string;
    "webhook-timestamp"?: string;
    "webhook-signature"?: string;
  }
): VerifiedWhopEvent {
  const secret = whopWebhookSecret();
  if (!secret)
    throw new WhopNotConfiguredError(
      "Nova's billing webhooks are not configured on this deployment yet."
    );
  const webhookId = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];
  if (!webhookId || !timestamp || !signatureHeader)
    throw new Error("Missing Whop webhook headers.");
  const sentAtSeconds = Number(timestamp);
  if (
    !Number.isFinite(sentAtSeconds) ||
    Math.abs(Date.now() / 1000 - sentAtSeconds) >
      WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  ) {
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
  const matches = offered.some(
    candidate =>
      candidate.length === expected.length &&
      crypto.timingSafeEqual(candidate, expected)
  );
  if (!matches) throw new Error("Whop webhook signature verification failed.");
  const event = JSON.parse(rawBody.toString("utf8")) as {
    id?: string;
    type?: string;
    data?: Record<string, unknown>;
  };
  if (!event.id || !event.type || !event.data)
    throw new Error("Whop webhook payload is malformed.");
  return { id: event.id, type: event.type, data: event.data };
}

/* ------------------------------------------------------------------------- */
/* Membership event handling                                                 */
/* ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return new Date(value * 1000);
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
function membershipToState(
  data: Record<string, unknown>,
  tier: PlanTier
): {
  state: WhopSubscriptionState;
  membershipId: string | null;
  ownerIdFromMetadata: number | null;
} {
  const metadata = asRecord(data.metadata);
  const rawOwnerId = metadata?.nova_user_id;
  const ownerIdFromMetadata =
    typeof rawOwnerId === "string" || typeof rawOwnerId === "number"
      ? Number(rawOwnerId)
      : NaN;
  const status = typeof data.status === "string" ? data.status : "inactive";
  const periodEnd = asDate(data.current_period_end);
  const active =
    ACTIVE_MEMBERSHIP_STATUSES.has(status) &&
    (periodEnd === null || periodEnd.getTime() > Date.now());
  return {
    state: {
      plan: active ? tier : "free",
      status,
      whopMembershipId: typeof data.id === "string" ? data.id : null,
      whopUserId: typeof data.user_id === "string" ? data.user_id : null,
      whopCheckoutConfigId: null,
      currentPeriodStart: asDate(data.current_period_start),
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    },
    membershipId: typeof data.id === "string" ? data.id : null,
    ownerIdFromMetadata:
      Number.isInteger(ownerIdFromMetadata) && ownerIdFromMetadata > 0
        ? ownerIdFromMetadata
        : null,
  };
}

export type WhopWebhookOutcome =
  | {
      handled: true;
      ownerId: number;
      plan: "free" | "plus" | "paid";
      status: string;
    }
  | { handled: true; ownerId: number; product: "priority"; armed: boolean }
  | {
      handled: true;
      ownerId: number;
      product: "credits";
      credits: number;
      granted: boolean;
    }
  | { handled: false; reason: string };

function planIdFromPayload(data: Record<string, unknown>): string | null {
  if (typeof data.plan_id === "string" && data.plan_id.trim())
    return data.plan_id.trim();
  const plan = asRecord(data.plan);
  if (plan && typeof plan.id === "string" && plan.id.trim())
    return plan.id.trim();
  return null;
}

function ownerIdFromMetadata(data: Record<string, unknown>): number | null {
  const metadata = asRecord(data.metadata);
  const rawOwnerId = metadata?.nova_user_id;
  const ownerId =
    typeof rawOwnerId === "string" || typeof rawOwnerId === "number"
      ? Number(rawOwnerId)
      : NaN;
  return Number.isInteger(ownerId) && ownerId > 0 ? ownerId : null;
}

function isPriorityProduct(data: Record<string, unknown>): boolean {
  const priorityPlanId = getWhopPriorityPlanId();
  const planId = planIdFromPayload(data);
  if (priorityPlanId && planId === priorityPlanId) return true;
  const metadata = asRecord(data.metadata);
  if (metadata?.nova_product === "priority") return true;
  const product = asRecord(data.product);
  const productMeta = asRecord(product?.metadata);
  return productMeta?.product === "priority";
}

/**
 * Whether a payload is marked as a credit top-up at all, regardless of whether
 * its bundle id resolves. This is what separates "not a credit payment" from
 * "a credit payment we cannot fulfil" - the latter means someone has paid and
 * received nothing, so it must be logged loudly rather than silently ignored.
 */
function isCreditTopUpMarked(data: Record<string, unknown>): boolean {
  const metadata = asRecord(data.metadata);
  const product = asRecord(data.product);
  const productMeta = asRecord(product?.metadata);
  return (
    metadata?.nova_product === CREDIT_TOPUP_PRODUCT_MARKER ||
    productMeta?.nova_product === CREDIT_TOPUP_PRODUCT_MARKER ||
    productMeta?.product === CREDIT_TOPUP_PRODUCT_MARKER ||
    typeof metadata?.nova_credit_product_id === "string"
  );
}

/**
 * The credit bundle a payment refers to, resolved from OUR catalog.
 *
 * The payload's credit amount is deliberately NOT trusted: a webhook body is
 * attacker-influenceable in principle, and a tampered or stale value must not be
 * able to mint credits. The metadata only carries the product id, and the
 * granted amount is read from the shared ladder.
 */
function creditTopUpProductFromPayload(
  data: Record<string, unknown>
): CreditTopUpProduct | undefined {
  const metadata = asRecord(data.metadata);
  const product = asRecord(data.product);
  const productMeta = asRecord(product?.metadata);
  const rawId =
    metadata?.nova_credit_product_id ?? productMeta?.nova_credit_product_id;
  const isMarked =
    metadata?.nova_product === CREDIT_TOPUP_PRODUCT_MARKER ||
    productMeta?.nova_product === CREDIT_TOPUP_PRODUCT_MARKER ||
    productMeta?.product === CREDIT_TOPUP_PRODUCT_MARKER;
  if (typeof rawId !== "string" || !rawId.trim()) return undefined;
  if (!isMarked) return undefined;
  return getCreditTopUpProduct(rawId.trim());
}

async function grantCreditTopUpFromWebhook(
  event: VerifiedWhopEvent,
  paymentOrMembershipId: string | null
): Promise<WhopWebhookOutcome> {
  const ownerId = ownerIdFromMetadata(event.data);
  if (ownerId === null) {
    await recordWhopWebhookEvent(event.id, event.type, paymentOrMembershipId);
    console.warn(
      "[Whop] credit top-up event with no resolvable Nova account",
      event.type,
      paymentOrMembershipId
    );
    return { handled: false, reason: "unknown-owner" };
  }
  const product = creditTopUpProductFromPayload(event.data);
  if (!product) {
    await recordWhopWebhookEvent(event.id, event.type, paymentOrMembershipId);
    // Loud, distinct from a generic ignore: a marked credit payment whose
    // bundle is not on the ladder means the customer has paid and received
    // nothing, and support needs to see it.
    console.error(
      "[Whop] UNFULFILLED credit purchase - paid but the bundle id is not in the catalog",
      event.type,
      paymentOrMembershipId
    );
    return { handled: false, reason: "unknown-credit-product" };
  }
  const firstDelivery = await recordWhopWebhookEvent(
    event.id,
    event.type,
    paymentOrMembershipId
  );
  if (!firstDelivery) return { handled: false, reason: "duplicate-delivery" };
  // The provider payment id is the idempotency key: Whop retries until it gets
  // a 2xx, and this insert conflicts on a replay rather than granting twice.
  const paymentId = paymentOrMembershipId ?? `event:${event.id}`;
  const { granted } = await grantCreditTopUp({
    ownerId,
    providerPaymentId: paymentId,
    product,
    currency: CREDIT_TOPUP_CURRENCY,
  });
  console.info(
    granted
      ? `[Whop] ${event.type}: account ${ownerId} granted ${product.credits} credits (${product.id})`
      : `[Whop] ${event.type}: account ${ownerId} already had payment ${paymentId} - no double grant`
  );
  return {
    handled: true,
    ownerId,
    product: "credits",
    credits: product.credits,
    granted,
  };
}

async function grantPriorityFromWebhook(
  event: VerifiedWhopEvent,
  paymentOrMembershipId: string | null
): Promise<WhopWebhookOutcome> {
  const ownerId = ownerIdFromMetadata(event.data);
  if (ownerId === null) {
    await recordWhopWebhookEvent(event.id, event.type, paymentOrMembershipId);
    console.warn(
      "[Whop] priority event with no resolvable Nova account",
      event.type,
      paymentOrMembershipId
    );
    return { handled: false, reason: "unknown-owner" };
  }
  const firstDelivery = await recordWhopWebhookEvent(
    event.id,
    event.type,
    paymentOrMembershipId
  );
  if (!firstDelivery) return { handled: false, reason: "duplicate-delivery" };

  const status = await purchasePriorityForUser(ownerId);
  console.info(
    `[Whop] ${event.type}: account ${ownerId} -> priority armed=${status.armed}`
  );
  return { handled: true, ownerId, product: "priority", armed: status.armed };
}

/**
 * Verifies, dedupes, and applies one webhook delivery. Replayed deliveries
 * (same webhook-id) are acknowledged without re-applying so a flaky first
 * response never double-activates anything.
 *
 * `payment.succeeded` (and membership activation for the priority plan) arms
 * one-hour priority. Other `membership.*` events update Nova Pro only.
 */
export async function handleWhopWebhook(
  rawBody: Buffer,
  headers: Parameters<typeof verifyWhopWebhook>[1]
): Promise<WhopWebhookOutcome> {
  const event = verifyWhopWebhook(rawBody, headers);

  if (event.type === "payment.succeeded" && isPriorityProduct(event.data)) {
    const paymentId = typeof event.data.id === "string" ? event.data.id : null;
    return grantPriorityFromWebhook(event, paymentId);
  }

  // A credit bundle is a one-time payment. It is checked before the
  // membership-only branch below, which would otherwise drop it.
  if (event.type === "payment.succeeded" && isCreditTopUpMarked(event.data)) {
    const paymentId = typeof event.data.id === "string" ? event.data.id : null;
    return grantCreditTopUpFromWebhook(event, paymentId);
  }

  if (!event.type.startsWith("membership.")) {
    return { handled: false, reason: `ignored-event:${event.type}` };
  }

  // A credit bundle can also arrive as a one-time membership (Whop models a
  // one-time checkout as a membership that never renews). Grant it on
  // activation, and never let it touch the Nova Pro subscription row.
  if (isCreditTopUpMarked(event.data)) {
    const membershipId =
      typeof event.data.id === "string" ? event.data.id : null;
    if (
      event.type === "membership.activated" ||
      event.type === "membership.went_valid"
    ) {
      return grantCreditTopUpFromWebhook(event, membershipId);
    }
    await recordWhopWebhookEvent(event.id, event.type, membershipId);
    return { handled: false, reason: "credit-membership-ignored" };
  }

  if (isPriorityProduct(event.data)) {
    // One-time priority memberships must never flip the Nova Pro subscription.
    if (
      event.type === "membership.activated" ||
      event.type === "membership.went_valid"
    ) {
      const membershipId =
        typeof event.data.id === "string" ? event.data.id : null;
      return grantPriorityFromWebhook(event, membershipId);
    }
    const membershipId =
      typeof event.data.id === "string" ? event.data.id : null;
    await recordWhopWebhookEvent(event.id, event.type, membershipId);
    return { handled: false, reason: "priority-membership-ignored" };
  }

  const pinnedPlanIds = [getWhopPlanId(), getWhopPlusPlanId()].filter(
    (id): id is string => Boolean(id)
  );
  const membershipPlanId = planIdFromPayload(event.data);
  if (
    pinnedPlanIds.length > 0 &&
    membershipPlanId &&
    !pinnedPlanIds.includes(membershipPlanId)
  ) {
    const membershipId =
      typeof event.data.id === "string" ? event.data.id : null;
    await recordWhopWebhookEvent(event.id, event.type, membershipId);
    return { handled: false, reason: "ignored-non-pro-membership" };
  }

  const membershipId = typeof event.data.id === "string" ? event.data.id : null;
  const firstDelivery = await recordWhopWebhookEvent(
    event.id,
    event.type,
    membershipId
  );
  if (!firstDelivery) return { handled: false, reason: "duplicate-delivery" };

  const { state, ownerIdFromMetadata: ownerFromMembership } = membershipToState(
    event.data,
    membershipPlanTier(event.data)
  );
  let ownerId = ownerFromMembership;
  if (ownerId === null && membershipId) {
    ownerId = await getOwnerIdForWhopMembership(membershipId);
  }
  if (ownerId === null) {
    // Not a Nova checkout (or one from before metadata existed) - keep the
    // delivery recorded so a retry does not loop, but change nothing.
    console.warn(
      "[Whop] membership event with no resolvable Nova account",
      event.type,
      membershipId
    );
    return { handled: false, reason: "unknown-owner" };
  }

  const summary = await upsertSubscriptionForUser(ownerId, state);
  console.info(
    `[Whop] ${event.type}: account ${ownerId} -> ${summary.plan} (${summary.status})`
  );
  return { handled: true, ownerId, plan: summary.plan, status: summary.status };
}
