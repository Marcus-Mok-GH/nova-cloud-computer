/**
 * Suggested follow-ups: the `follow_up` tool lets the agent propose up to
 * three next actions for the user, and the run persists them beneath the
 * closing reply as an internal ledger row. The web client reads that row and
 * renders the suggestions as tappable chips; the raw row is never shown as
 * chat text and never reaches the model's conversation history.
 */

import { FOLLOW_UP_MESSAGE_PREFIX } from "@shared/const";

/** Prefix of the internal ledger row holding one turn's follow-up suggestions. */
export { FOLLOW_UP_MESSAGE_PREFIX };

/** The most suggestions one turn may show. The tool schema says the same. */
export const MAX_FOLLOW_UPS = 3;

/** Sanity cap so one runaway suggestion cannot bloat the chat ledger. */
const MAX_FOLLOW_UP_CHARS = 200;

/**
 * Normalizes whatever the model passed as follow_ups into the stored list:
 * strings only, trimmed, de-duplicated case-insensitively, capped at
 * MAX_FOLLOW_UPS entries. Anything unusable - a missing field, non-strings,
 * blank entries - is dropped rather than stored, and callers treat an empty
 * result as "nothing to suggest".
 */
export function normalizeFollowUps(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const seen = new Set<string>();
  const followUps: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const text = item.trim().slice(0, MAX_FOLLOW_UP_CHARS);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    followUps.push(text);
    if (followUps.length >= MAX_FOLLOW_UPS) break;
  }
  return followUps;
}

/** Builds the internal ledger row a turn's suggestions are persisted as. */
export function buildFollowUpMessage(followUps: string[]): string {
  return `${FOLLOW_UP_MESSAGE_PREFIX}${JSON.stringify(
    followUps.slice(0, MAX_FOLLOW_UPS)
  )}`;
}

/** Parses a ledger row back into suggestions; null when it is not a valid one. */
export function parseFollowUpMessage(content: string): string[] | null {
  if (!content.startsWith(FOLLOW_UP_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      content.slice(FOLLOW_UP_MESSAGE_PREFIX.length)
    ) as unknown;
    const followUps = normalizeFollowUps(parsed);
    return followUps.length ? followUps : null;
  } catch {
    return null;
  }
}
