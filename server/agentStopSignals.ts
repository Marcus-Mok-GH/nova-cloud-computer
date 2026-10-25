/**
 * In-process record of the stop requests this instance served.
 *
 * A running agent checks for `/stop` while its reply streams. Reading that from
 * the database on every check cost a query several times a second for a flag
 * that almost never changes, so a stop served by this instance is remembered
 * here instead: the run notices it immediately without touching the database.
 * A stop served by another instance (or by a preceding instance, after a cold
 * start) is still picked up by the run's slower database poll.
 */

type StopSignal = { ownerId: number; chatId: string | null; at: number };

/** Signals older than this cannot match any in-flight run, so they are pruned. */
const SIGNAL_TTL_MS = 10 * 60_000;
/** A hard cap keeps a long-lived instance from growing this list without bound. */
const MAX_SIGNALS = 256;

let signals: StopSignal[] = [];

function prune(now: number) {
  signals = signals.filter(signal => now - signal.at < SIGNAL_TTL_MS);
  if (signals.length > MAX_SIGNALS) {
    signals = signals.slice(signals.length - MAX_SIGNALS);
  }
}

/** Records a stop request this instance just served. */
export function noteAgentStop(ownerId: number, chatId: string | null, at = Date.now()) {
  prune(at);
  signals.push({ ownerId, chatId, at });
}

/**
 * True when this instance served a stop for the run: the owner matches, the
 * request came after `startedAt`, and it either names the run's chat or is
 * workspace-wide (no chat).
 */
export function hasLocalAgentStopAfter(
  ownerId: number,
  chatId: string | undefined,
  startedAt: Date
): boolean {
  if (signals.length === 0) return false;
  const startedAtMs = startedAt.getTime();
  return signals.some(
    signal =>
      signal.ownerId === ownerId &&
      signal.at > startedAtMs &&
      (signal.chatId === null || chatId === undefined || signal.chatId === chatId)
  );
}

/** Test helper: forget every recorded signal. */
export function resetAgentStopSignals() {
  signals = [];
}
