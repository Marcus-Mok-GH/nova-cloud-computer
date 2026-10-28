/**
 * Pre-launch waitlist window.
 *
 * Until `NOVA_WAITLIST_END_AT`, `/sign-in` shows the waitlist instead of the
 * passwordless flow. The instant is a constant rather than a deploy: on
 * 1 November the real sign-in comes back on its own, with no release, no flag
 * flip, and no chance of someone forgetting to undo a temporary change.
 */
export const NOVA_WAITLIST_END_ISO = "2026-11-01T00:00:00.000Z";
export const NOVA_WAITLIST_END_MS = Date.parse(NOVA_WAITLIST_END_ISO);

/** `?waitlist=0` (or `off` / `false`) always serves the real sign-in. */
export const WAITLIST_BYPASS_PARAM = "waitlist";

export function isWaitlistActive(nowMs: number = Date.now()): boolean {
  return nowMs < NOVA_WAITLIST_END_MS;
}

export function isWaitlistBypassed(search: string | null | undefined): boolean {
  if (!search) return false;
  const value = new URLSearchParams(search).get(WAITLIST_BYPASS_PARAM)?.trim().toLowerCase();
  return value === "0" || value === "off" || value === "false";
}

/** Human-readable launch date used in waitlist copy, e.g. "1 November". */
export function waitlistLaunchLabel(): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(NOVA_WAITLIST_END_MS));
}