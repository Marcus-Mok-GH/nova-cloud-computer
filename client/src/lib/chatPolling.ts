/**
 * Chat transcript polling cadence.
 *
 * The fetch stream is the delivery path for a turn this browser owns; these
 * polls are the safety net for turns that started elsewhere (peak-hours queue,
 * Telegram, a continuation segment) or that began after the stream settled.
 * They must stay fast while anything can still be working - an active run OR a
 * queued notice - because the alternative is a view that looks idle while the
 * reply is already on its way, and only catches up on the slow idle cadence.
 */

export type ChatPollState = {
  /** A live agent run is in flight for this chat. */
  active: boolean;
  /** This browser has an unfinished fetch stream for the turn. */
  streaming: boolean;
  /** The server admitted the turn to the peak-hours queue. */
  queued: boolean;
};

const FAST_RUN_STATUS_MS = 3_000;
const FAST_MESSAGES_MS = 5_000;
const IDLE_POLL_MS = 30_000;

/** Run-status poll cadence: fast while a run or a queued turn can be working. */
export function runStatusIntervalMs(state: Pick<ChatPollState, "active" | "queued">): number {
  return state.active || state.queued ? FAST_RUN_STATUS_MS : IDLE_POLL_MS;
}

/** Transcript poll cadence: fast while any delivery path may still be writing. */
export function messagesIntervalMs(state: ChatPollState): number {
  return state.active || state.streaming || state.queued ? FAST_MESSAGES_MS : IDLE_POLL_MS;
}
