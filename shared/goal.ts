import { GOAL_MESSAGE_PREFIX } from "./const";

/**
 * A conversation's autonomous goal (`/goal <objective>`): an outcome the agent
 * keeps working toward on its own - round after round, and across the chained
 * segments a long run is split into - until it reports the goal met or blocked.
 *
 * The state lives in internal ledger rows, one per change, parsed here so the
 * server (which decides whether a run is a goal chase) and the client (which
 * labels the conversation) always agree on what the goal is and where it
 * stands. The marker prefix is the byte-for-byte contract in `./const`.
 */

export type GoalStatus =
  /** Being chased: the next segment, or the user's next message, continues it. */
  | "active"
  /** The agent reported the objective achieved, with its evidence. */
  | "met"
  /** The agent reported it cannot advance without the user. */
  | "unfinished"
  /** The user dropped it with `/goal clear`. */
  | "cleared";

export interface GoalState {
  /** The outcome to reach, as the user phrased it. Empty on a cleared row. */
  objective: string;
  status: GoalStatus;
  /**
   * How many runs have chased this goal. Bounded by
   * {@link MAX_GOAL_SEGMENTS} so an unmet goal cannot spend credits forever.
   */
  segments: number;
}

/**
 * The most runs one goal may consume before the chase stops. Each run is itself
 * bounded by the run budget (just under the 300s function ceiling), so this
 * caps a single goal at roughly half an hour of unattended work.
 */
export const MAX_GOAL_SEGMENTS = 6;

/**
 * How many times one run re-prompts itself after the model ended its turn
 * without reporting a goal outcome - the bound that keeps a model which
 * insists on stopping from looping.
 */
export const MAX_GOAL_CONTINUATIONS = 3;

/** Cap on an objective's length, so one command cannot bloat the ledger. */
export const MAX_GOAL_CHARS = 600;

/** The ledger row recording a goal's state. */
export function formatGoalMarker(state: GoalState): string {
  return `${GOAL_MESSAGE_PREFIX}${JSON.stringify({
    objective: state.objective,
    status: state.status,
    segments: state.segments,
  })}`;
}

/**
 * Reads a goal row back. Anything unusable - a truncated row, an unknown
 * status, a missing objective on a row that must have one - parses to null, so
 * a damaged row is treated as "no goal" rather than chased.
 */
export function parseGoalMarker(content: string): GoalState | null {
  if (!content.startsWith(GOAL_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(content.slice(GOAL_MESSAGE_PREFIX.length)) as {
      objective?: unknown;
      status?: unknown;
      segments?: unknown;
    };
    const objective =
      typeof parsed?.objective === "string" ? parsed.objective.trim() : "";
    const status = parsed?.status;
    if (
      status !== "active" &&
      status !== "met" &&
      status !== "unfinished" &&
      status !== "cleared"
    )
      return null;
    // Only a cleared row may be objective-less: it records that the goal is
    // gone, and there is nothing left to label.
    if (!objective && status !== "cleared") return null;
    const segments =
      typeof parsed?.segments === "number" && Number.isFinite(parsed.segments)
        ? Math.max(0, Math.floor(parsed.segments))
        : 0;
    return { objective, status, segments };
  } catch {
    return null;
  }
}

/**
 * The goal a conversation is on: the latest row wins, exactly like the
 * workflow-mode markers. Null when the conversation never had a goal.
 *
 * Only rows the server wrote count. Untrusted text reaches the ledger as the
 * user's message - the body of an inbound email is persisted verbatim - and a
 * goal makes the agent work unattended, so text somebody else wrote must not be
 * able to install one. Every real goal row is written by the server as an
 * assistant row; `/goal <objective>` is read from the user's turn by
 * `parseGoalCommand`, never from a ledger row.
 */
export function latestGoalState(
  messages: Array<{ role: string; content: string }>
): GoalState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const state = parseGoalMarker(message.content);
    if (state) return state;
  }
  return null;
}
