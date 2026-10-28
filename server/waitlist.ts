import type { NextFunction, Request, Response } from "express";

/**
 * Waitlist signups, stored outside Nova's own database.
 *
 * The list lives in Buttondown, so signups survive deploys and keep working
 * while the database is unavailable. Two ways in: the API (when
 * `BUTTONDOWN_API_KEY` is set, which tags each address for later sending) and
 * the public embed endpoint (no key, no CORS, proxied from the server).
 */

export const WAITLIST_TAG = "nova-waitlist";
const WAITLIST_EMAIL_MAX_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_MAX_TRACKED_IPS = 5_000;

export type WaitlistResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Trims and lowercases an address, or returns null when it is not usable. */
export function normalizeWaitlistEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > WAITLIST_EMAIL_MAX_LENGTH) return null;
  if (!EMAIL_SHAPE.test(email)) return null;
  return email;
}

export type WaitlistConfig = {
  username?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

function readConfig(): WaitlistConfig {
  return {
    username: process.env.BUTTONDOWN_USERNAME?.trim() || undefined,
    apiKey: process.env.BUTTONDOWN_API_KEY?.trim() || undefined,
  };
}

export function isWaitlistConfigured(config: WaitlistConfig = readConfig()): boolean {
  return Boolean(config.username || config.apiKey);
}

type SubscribeOutcome = { ok: true } | { ok: false; reason: "already-subscribed" | "provider-error" };

async function subscribeWithApi(email: string, config: WaitlistConfig, fetchImpl: typeof fetch): Promise<SubscribeOutcome> {
  const response = await fetchImpl("https://api.buttondown.com/v1/subscribers", {
    method: "POST",
    headers: {
      authorization: `Token ${config.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ email_address: email, tags: [WAITLIST_TAG], type: "regular" }),
  });
  if (response.ok) return { ok: true };
  // Buttondown answers 400 for an address that is already subscribed. That is
  // the outcome the visitor wanted, so it is not an error for us.
  if (response.status === 400) {
    const detail = await response.text().catch(() => "");
    if (/already|exists|subscribed/i.test(detail)) return { ok: false, reason: "already-subscribed" };
  }
  return { ok: false, reason: "provider-error" };
}

async function subscribeWithEmbed(email: string, config: WaitlistConfig, fetchImpl: typeof fetch): Promise<SubscribeOutcome> {
  const body = new URLSearchParams({ email, tag: WAITLIST_TAG });
  const response = await fetchImpl(`https://buttondown.com/api/emails/embed-subscribe/${encodeURIComponent(config.username!)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    body,
    redirect: "manual",
  });
  // The embed endpoint reports success by redirecting to its thank-you page.
  if (response.ok || (response.status >= 300 && response.status < 400)) return { ok: true };
  // With double opt-in on, the endpoint answers 400 and renders its
  // "Verify Your Subscription" page: the address was recorded and Buttondown
  // has mailed a confirmation link. That is a signup, not a failure.
  if (response.status === 400) {
    const detail = await response.text().catch(() => "");
    if (/verify/i.test(detail) && !/not valid|invalid/i.test(detail)) return { ok: true };
  }
  return { ok: false, reason: "provider-error" };
}

/**
 * Adds an address to the list. Idempotent: an address that is already there is
 * a success, never an error the visitor has to act on.
 */
export async function subscribeToWaitlist(
  email: string,
  config: WaitlistConfig = readConfig()
): Promise<WaitlistResult> {
  if (!isWaitlistConfigured(config)) return { ok: false, status: 503, error: "waitlist-not-configured" };
  const fetchImpl = config.fetchImpl ?? fetch;

  try {
    const attempts: Array<() => Promise<SubscribeOutcome>> = [];
    if (config.apiKey) attempts.push(() => subscribeWithApi(email, config, fetchImpl));
    if (config.username) attempts.push(() => subscribeWithEmbed(email, config, fetchImpl));

    for (const attempt of attempts) {
      const outcome = await attempt();
      if (outcome.ok) return { ok: true };
      if (outcome.reason === "already-subscribed") return { ok: true };
    }
    return { ok: false, status: 502, error: "waitlist-provider-error" };
  } catch (error) {
    console.error("[Waitlist] provider request failed", error);
    return { ok: false, status: 502, error: "waitlist-provider-error" };
  }
}

type Attempt = { count: number; resetAt: number };
const attemptsByIp = new Map<string, Attempt>();

/** Coarse per-IP throttle: enough to stop a script, invisible to a person. */
export function allowWaitlistAttempt(ip: string, now: number = Date.now()): boolean {
  const existing = attemptsByIp.get(ip);
  if (!existing || now >= existing.resetAt) {
    if (attemptsByIp.size >= RATE_LIMIT_MAX_TRACKED_IPS) attemptsByIp.clear();
    attemptsByIp.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX_ATTEMPTS) return false;
  existing.count += 1;
  return true;
}

/** Exposed for tests; production never needs to clear the map. */
export function resetWaitlistRateLimit(): void {
  attemptsByIp.clear();
}

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = header?.split(",")[0]?.trim();
  return first || req.ip || "unknown";
}

/**
 * `POST /api/waitlist` - `{ email, company }`.
 *
 * `company` is a honeypot: it is hidden in the UI and must arrive empty.
 */
export function createWaitlistHandler(config: WaitlistConfig = readConfig()) {
  return async function handleWaitlistSignup(req: Request, res: Response, _next: NextFunction) {
    try {
      if (!allowWaitlistAttempt(clientIp(req))) {
        return res.status(429).json({ error: "too-many-attempts" });
      }

      const body = (req.body ?? {}) as { email?: unknown; company?: unknown };
      if (typeof body.company === "string" && body.company.trim().length > 0) {
        // Pretend it worked so a bot learns nothing from the response.
        return res.status(200).json({ ok: true });
      }

      const email = normalizeWaitlistEmail(body.email);
      if (!email) return res.status(400).json({ error: "enter-a-valid-email" });

      const result = await subscribeToWaitlist(email, config);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[Waitlist] signup failed", error);
      return res.status(500).json({ error: "waitlist-failed" });
    }
  };
}