/**
 * The quiet-stream heartbeat shared by the long-running sub-agent tools
 * (editor, research_web, thinker).
 *
 * Each tool streams real progress notes as it learns something, but a silent
 * gap - a long model call, a slow sandbox command - would otherwise look
 * frozen in the activity panel. The nudge fills any 25-second silence with an
 * elapsed-time line, so the log shows work rather than ticking, and stops with
 * the tool call.
 */

/** Silence before a note is replaced by an elapsed-time line. */
const QUIET_AFTER_MS = 25_000;
/** How often the heartbeat checks whether the stream has gone quiet. */
const TICK_MS = 10_000;

export type ProgressNudge = {
  /** Records a real progress note and resets the silence clock. */
  note: (detail: string) => void;
  /** Stops the heartbeat timer. Safe to call more than once. */
  stop: () => void;
};

export function createProgressNudge(options: {
  /** Where notes go; absent on runs without a progress sink. */
  onProgress?: (detail: string) => void;
  /** When the tool call started (epoch ms); elapsed time is measured from here. */
  startedAt: number;
  /** Builds the still-working line for an elapsed time in seconds. */
  stillWorking: (elapsedSeconds: number) => string;
}): ProgressNudge {
  let lastNoteAt = Date.now();
  const note = (detail: string) => {
    lastNoteAt = Date.now();
    options.onProgress?.(detail);
  };
  if (!options.onProgress) return { note, stop: () => {} };
  const timer = setInterval(() => {
    if (Date.now() - lastNoteAt < QUIET_AFTER_MS) return;
    lastNoteAt = Date.now();
    const elapsed = Math.round((Date.now() - options.startedAt) / 1000);
    options.onProgress?.(options.stillWorking(elapsed));
  }, TICK_MS);
  return { note, stop: () => clearInterval(timer) };
}
