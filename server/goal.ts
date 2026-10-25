import { GOAL_COMMAND } from "@shared/commands";
import {
  formatGoalMarker,
  MAX_GOAL_CHARS,
  type GoalState,
} from "@shared/goal";
import { appendChatMessageForUser } from "./db";
import type { WorkspaceAgentOptions } from "./workspace/workspaceAgentTypes";

/**
 * The `/goal <objective>` command: an autonomous chase. Unlike an ordinary
 * request - which the agent finishes inside one turn - a goal keeps the agent
 * working round after round, and across the chained segments a long run is
 * split into, until it reports the objective achieved or blocked.
 *
 * The chase is deliberately bounded: the model has to say when the goal is
 * done ({@link REPORT_GOAL_TOOL}), a run that ends its turn without saying so
 * is prompted back to work only so many times, and the goal as a whole only
 * gets so many runs. Without those bounds an unmet goal would spend credits
 * unattended forever.
 */

/**
 * Re-exported from `shared/commands`, which is where the name of every slash
 * command lives, so the composer's slash menu and this parser cannot disagree
 * about what the command is called.
 */
export { GOAL_COMMAND };

/**
 * Matches the command at the very start of a message, optionally addressed to a
 * bot (`/goal@NovaBot`, which Telegram appends in group chats), and captures
 * everything after it as the objective. Built from the shared name so renaming
 * the command cannot leave this parser matching the old one.
 */
const GOAL_PATTERN = new RegExp(
  `^\\s*${GOAL_COMMAND}(?:@[A-Za-z0-9_]+)?(?:\\s|$)([\\s\\S]*)$`,
  "i"
);

/** The words that drop a goal instead of setting one. */
const GOAL_CLEAR_WORDS = /^(clear|reset|cancel)$/i;

export type GoalCommand =
  /** `/goal <objective>` - start chasing (or replace) the objective. */
  | { kind: "set"; objective: string }
  /** `/goal clear` - drop the goal this conversation was chasing. */
  | { kind: "clear" }
  /** A bare `/goal` - answer with usage instead of chasing anything. */
  | { kind: "usage" };

/**
 * Parses a message as the `/goal` command, or null when it is not the command.
 */
export function parseGoalCommand(text: unknown): GoalCommand | null {
  if (typeof text !== "string") return null;
  const match = GOAL_PATTERN.exec(text);
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  if (!rest) return { kind: "usage" };
  if (GOAL_CLEAR_WORDS.test(rest)) return { kind: "clear" };
  return { kind: "set", objective: rest.slice(0, MAX_GOAL_CHARS) };
}

/** Shown when `/goal` is sent with nothing to aim at. */
export const GOAL_USAGE =
  'To set a goal, send it with the outcome to reach - for example "/goal get the landing page to Lighthouse 95". I will keep working on it on my own, round after round, reporting progress as I go, and stop when the outcome is reached or I am blocked. Send "/goal clear" to drop it.';

/** Confirmation when a goal is dropped. */
export const GOAL_CLEARED_MESSAGE =
  "Goal cleared - this conversation is back to ordinary requests. Send /goal with a new outcome whenever you want me chasing one again.";

/**
 * The tool the model calls to end a chase. It is a local control call like
 * end_turn: it changes nothing in the workspace, it only records where the goal
 * stands so the chase stops, the ledger is honest, and the user is told the
 * outcome.
 */
export const REPORT_GOAL_TOOL = "report_goal";

export type GoalOutcome = "met" | "blocked";

/** The turn instruction that starts a chase and defines how it ends. */
export function buildGoalInstruction(
  objective: string,
  channel: WorkspaceAgentOptions["channel"] = "web",
  options: { segments: number; maxSegments: number } = {
    segments: 1,
    maxSegments: 1,
  }
): string {
  const formatting =
    channel === "telegram"
      ? "This request arrived over Telegram, so keep every message plain text: no markdown of any kind. The user sees only the messages you send - never your tool activity - so use send_progress_update to keep them posted between rounds."
      : "This request arrived in the Nova web app, where the user watches your tool activity live and reads each round's report as its own message, so keep every round report short and concrete.";
  const budget =
    options.maxSegments > 1
      ? ` This chase has already used ${options.segments - 1} of the ${options.maxSegments} runs it is allowed, so if the objective is close to done, drive it to the end now.`
      : "";
  return `[GOAL - autonomous pursuit]
The user set this goal: ${objective}

Work on it yourself, round after round, until it is achieved. Planning IS NOT the deliverable here and neither is asking how to proceed: take the next concrete step with your tools, verify what it changed, and keep going. Each round, end your turn with end_turn carrying a short report of what that round did - the run persists it as a progress message and continues the chase automatically, so end_turn does not end the pursuit by itself. Never reply with only a plan, never ask the user to run steps you can run, and never claim an outcome you have not verified.

The chase ends in exactly one of two ways, both through the ${REPORT_GOAL_TOOL} tool:
- Call ${REPORT_GOAL_TOOL} with outcome "met" once the objective is genuinely achieved, and put the evidence you checked (the measurement, the file, the command output) in detail. Then end_turn with your final report.
- Call ${REPORT_GOAL_TOOL} with outcome "blocked" if you cannot advance without the user - a credential, a decision, a purchase, or something only they can do - and say exactly what you need in detail. Then end_turn and explain it plainly.
Do not call ${REPORT_GOAL_TOOL} to hand back a plan, to ask a clarifying question you could answer yourself, or before you have actually tried.${budget} ${formatting}`;
}

/**
 * The prompt that continues a chase whose round ended without a goal outcome:
 * the model said it was done for now, but the goal is not, so it is sent back
 * to work rather than ending the run.
 */
export function buildGoalContinuationPrompt(objective: string): string {
  return `[GOAL - chase continues]
Your turn ended without a goal outcome, so the chase is still running. The goal is not finished: ${objective}
Take the next concrete step toward it now with your tools - do not restate your last report, do not hand back a plan, and do not ask the user to do something you can do yourself. When the objective is genuinely achieved, call ${REPORT_GOAL_TOOL} with outcome "met" and the evidence, then end_turn. If you truly cannot advance without the user, call ${REPORT_GOAL_TOOL} with outcome "blocked" and exactly what you need, then end_turn.`;
}

/**
 * Records a goal's state as an internal ledger row. Both sides read these rows
 * through `@shared/goal`, and they are filtered out of the model's history and
 * the visible transcript like every other bookkeeping row.
 *
 * Never throws: a ledger hiccup must not fail the run around it. The chase the
 * caller already decided on still happens - only the row that would have
 * outlived it is missing.
 */
export async function recordGoalState(
  ownerId: number,
  chatId: string,
  state: GoalState
): Promise<void> {
  try {
    await appendChatMessageForUser(ownerId, {
      chatId,
      role: "assistant",
      content: formatGoalMarker(state),
    });
  } catch (error) {
    console.error("[Goal] failed to record the goal state", error);
  }
}
