/**
 * Peak-hours admission control for Nova's shared inference pool.
 *
 * Outside the daily peak window a user message runs immediately, exactly as
 * before. Inside it, each message is admitted to one FIFO queue instead of
 * being rejected: the sender is told "You are N in the queue.", the queue
 * worker runs one request at a time so the pool is never saturated, and the
 * reply is delivered through the same channel the message arrived on.
 *
 * The window and the on/off switch are both env-overridable so an operator can
 * retune peak hours without a code change.
 */

/** Peak admission defaults to 14:00-18:00 UTC. */
export const DEFAULT_PEAK_START_HOUR_UTC = 14;
export const DEFAULT_PEAK_END_HOUR_UTC = 18;

export type PeakWindow = { startHour: number; endHour: number };

const DEFAULT_PEAK_WINDOW: PeakWindow = {
  startHour: DEFAULT_PEAK_START_HOUR_UTC,
  endHour: DEFAULT_PEAK_END_HOUR_UTC,
};

function parseHour(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;
  const hour = Number(value);
  return hour >= 0 && hour <= 24 ? hour : null;
}

/**
 * Parses "14-18" into a window. A single hour ("14") means that hour only.
 * Start === end is rejected as ambiguous; anything unparseable falls back to
 * the default window so a typo can never disable peak admission by accident.
 */
export function parsePeakWindow(raw: string | undefined): PeakWindow {
  if (!raw || !raw.trim()) return DEFAULT_PEAK_WINDOW;
  const match = /^\s*(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*$/.exec(raw);
  if (!match) return DEFAULT_PEAK_WINDOW;
  const startHour = parseHour(match[1]);
  if (startHour === null) return DEFAULT_PEAK_WINDOW;
  const endHour = match[2] === undefined ? (startHour + 1) % 24 : parseHour(match[2]);
  if (endHour === null || startHour === endHour) return DEFAULT_PEAK_WINDOW;
  return { startHour, endHour };
}

export function getPeakWindow(): PeakWindow {
  return parsePeakWindow(process.env.NOVA_PEAK_HOURS_UTC);
}

/** Peak admission is on by default; NOVA_PEAK_QUEUE=off|false|0|disabled turns it off. */
export function isPeakQueueEnabled(): boolean {
  const raw = process.env.NOVA_PEAK_QUEUE?.trim().toLowerCase();
  return !(raw === "off" || raw === "false" || raw === "0" || raw === "disabled");
}

/**
 * True when `now` falls inside the peak window (UTC). A window whose end is at
 * or before its start wraps past midnight (e.g. 22-6), which keeps overnight
 * peak configurations working without special cases at the call site.
 */
export function isPeakHour(now: Date = new Date(), window: PeakWindow = getPeakWindow()): boolean {
  const hour = now.getUTCHours();
  if (window.startHour < window.endHour) {
    return hour >= window.startHour && hour < window.endHour;
  }
  return hour >= window.startHour || hour < window.endHour;
}

/** Whether a new message must enter the queue right now (enabled + inside peak). */
export function shouldQueue(now: Date = new Date()): boolean {
  return isPeakQueueEnabled() && isPeakHour(now);
}

function formatHour(hour: number): string {
  return `${String(hour % 24).padStart(2, "0")}:00`;
}

/** Human label for the configured window, e.g. "14:00-18:00 UTC". */
export function formatPeakWindow(window: PeakWindow = getPeakWindow()): string {
  return `${formatHour(window.startHour)}-${formatHour(window.endHour)} UTC`;
}

/** The user-facing queue notice. Position is 1-based; anything below 1 clamps to 1. */
export function queuePositionMessage(position: number): string {
  const safe = Number.isFinite(position) ? Math.max(1, Math.floor(position)) : 1;
  return `You are ${safe} in the queue.`;
}

/**
 * The confirmation shown on the message that starts a purchased priority
 * window, so the sender knows the one-hour countdown has begun.
 */
export function priorityActiveMessage(): string {
  return "Priority active for 1 hour. Your requests now jump ahead during peak hours.";
}
