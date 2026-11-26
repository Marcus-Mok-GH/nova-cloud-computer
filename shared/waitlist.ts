/**
 * Temporary waitlist window.
 *
 * Nova's database hit its provider quota, so every database-backed surface is
 * unavailable until the limits reset on 1 December. Until `NOVA_WAITLIST_END_AT`
 * the routes that need the database show the waitlist instead of failing.
 *
 * The instant is a constant rather than a deploy: when the limits reset the
 * real sign-in comes back on its own, with no release, no flag flip, and no
 * chance of someone forgetting to undo a temporary change.
 */
export const NOVA_WAITLIST_END_ISO = "2026-12-01T00:00:00.000Z";
export const NOVA_WAITLIST_END_MS = Date.parse(NOVA_WAITLIST_END_ISO);

/** `?waitlist=0` (or `off` / `false`) always serves the real product. */
export const WAITLIST_BYPASS_PARAM = "waitlist";

/**
 * The routes that need the database, and so show the waitlist while it is
 * active. The landing page and the API docs are deliberately absent: both are
 * static, they keep working during the outage, and the landing page is the
 * funnel that leads to the waitlist.
 */
export const WAITLIST_GATED_PATHS = ["/sign-in", "/app", "/checkout"] as const;

export function isWaitlistActive(nowMs: number = Date.now()): boolean {
  return nowMs < NOVA_WAITLIST_END_MS;
}

export function isWaitlistBypassed(search: string | null | undefined): boolean {
  if (!search) return false;
  const value = new URLSearchParams(search).get(WAITLIST_BYPASS_PARAM)?.trim().toLowerCase();
  return value === "0" || value === "off" || value === "false";
}

/** True when the path is one of the database-backed routes the gate covers. */
export function isWaitlistGatedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return WAITLIST_GATED_PATHS.some(
    gated => normalized === gated || normalized.startsWith(`${gated}/`)
  );
}

/**
 * True when this path should render the waitlist right now: the window is
 * open, the path is database-backed, and the owner has not asked for the real
 * product with `?waitlist=0`.
 */
export function shouldShowWaitlist(
  pathname: string | null | undefined,
  search: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!isWaitlistActive(nowMs)) return false;
  if (isWaitlistBypassed(search)) return false;
  return isWaitlistGatedPath(pathname);
}

/** Human-readable return date used in waitlist copy, e.g. "1 December". */
export function waitlistReopenLabel(): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(NOVA_WAITLIST_END_MS));
}
