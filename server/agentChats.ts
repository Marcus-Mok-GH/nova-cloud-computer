import { runWorkspaceAgent } from "./workspaceAgent";
import type { AgentChatRoute, AgentProfileContext } from "./agents";

/**
 * Team orchestration: a team chat is a bounded collaborative discussion, not a
 * one-shot hand-off chain. Every roster member contributes once per round, in
 * roster order, inside a single agent run; from the second round on each member
 * reads the teammates' earlier turns and builds on them, and the last member of
 * the final round synthesizes the whole discussion into one reply for the user.
 * The first turn carries the user's real message (persisted once, exactly like
 * any chat); every later turn receives an internal note that is never persisted
 * - the chat ledger stays clean (user message, then each agent's attributed
 * reply) while every teammate still sees the full conversation as context.
 * Replies are prefixed `[Name]` so the user can tell who spoke.
 */

/** Run options accepted by runWorkspaceAgent, narrowed for orchestration. */
export type TeamRunOptions = NonNullable<Parameters<typeof runWorkspaceAgent>[3]>;

export type TeamChatRoute = Extract<AgentChatRoute, { kind: "team" }>;

/** An opening pass plus one refinement pass - a bounded discussion, not a loop. */
export const TEAM_DISCUSSION_ROUNDS = 2;

/**
 * A refinement round only starts when this much of the shared run budget is
 * still left. Each member is a full agent run, so beginning a second pass on a
 * nearly-spent budget would only produce teammates that cannot finish; the
 * discussion then ends after the opening round instead.
 */
const EXTRA_ROUND_MIN_REMAINING_MS = 75_000;

/**
 * The internal note that hands the conversation to the next teammate. It is
 * shown to that teammate's model as the current turn but never written to the
 * chat - the teammates' earlier replies already reach it through history.
 */
export function teamTurnPrompt(input: {
  member: AgentProfileContext;
  route: TeamChatRoute;
  teammateNames: string[];
  isFinal: boolean;
  /** 1-based discussion round. */
  round: number;
  /** Total rounds the discussion will run. */
  rounds: number;
}): string {
  const { member, route, teammateNames, isFinal, round, rounds } = input;
  const others = teammateNames.filter(name => name !== member.name);
  return [
    `You are ${member.name}, taking your turn in a collaborative agent team discussion (round ${round} of ${rounds}).`,
    `Team goal: ${route.goal}.`,
    others.length
      ? `Your teammates: ${others.join(", ")}. Their earlier turns are in the conversation above - read them, build on what is useful, and correct anything you believe is wrong instead of repeating it.`
      : "",
    isFinal
      ? "You are the last teammate this round and no further round follows: synthesize the whole team's combined work into one clear final reply for the user, then call end_turn."
      : round <= 1
        ? "This is the opening round. Contribute your own part of the goal now - the others will build on it in the next round - then call end_turn."
        : "React to your teammates' contributions above: add what is missing, sharpen what is vague, and refine the team's shared answer, then call end_turn.",
  ]
    .filter(Boolean)
    .join(" ");
}

type TeamRunResult = Awaited<ReturnType<typeof runWorkspaceAgent>>;

/**
 * Runs one full team discussion: every roster member contributes once per round,
 * in order, against the shared run deadline. The result is the final teammate's
 * run (or an earlier one that ran out of budget - the discussion stops there so
 * the shared serverless budget is never blown by starting another member).
 */
export async function runTeamChatTurns(input: {
  ownerId: number;
  chatId: string;
  content: string;
  route: TeamChatRoute;
  options: TeamRunOptions;
}): Promise<TeamRunResult> {
  const { ownerId, chatId, content, route, options } = input;
  const roster = route.roster;
  // Defensive fallback: a rosterless team degrades to ordinary Nova rather
  // than producing no reply at all (resolveAgentChatRoute normally prevents
  // this, but the roster can shrink between resolution and execution).
  if (!roster.length) return runWorkspaceAgent(ownerId, chatId, content, options);
  const teammateNames = roster.map(member => member.name);
  // A lone agent has nobody to discuss with; an extra round also needs enough
  // of the shared budget left to actually complete another full pass.
  const deadlineAtMs = options.deadlineAtMs;
  const rounds =
    roster.length > 1 &&
    (deadlineAtMs === undefined ||
      deadlineAtMs - Date.now() > EXTRA_ROUND_MIN_REMAINING_MS)
      ? TEAM_DISCUSSION_ROUNDS
      : 1;
  let last: TeamRunResult | undefined;
  for (let round = 1; round <= rounds; round += 1) {
    for (let index = 0; index < roster.length; index += 1) {
      const member = roster[index];
      // Only the opening turn writes the user's message; every later turn is
      // an internal note that stays out of the ledger.
      const isFirstTurn = round === 1 && index === 0;
      const isFinal = round === rounds && index === roster.length - 1;
      last = await runWorkspaceAgent(
        ownerId,
        chatId,
        isFirstTurn
          ? content
          : teamTurnPrompt({
              member,
              route,
              teammateNames,
              isFinal,
              round,
              rounds,
            }),
        {
          ...options,
          persistUserMessage: isFirstTurn,
          agentChat: {
            profile: member,
            team: {
              goal: route.goal,
              roster: roster.map(m => ({
                id: m.id,
                name: m.name,
                role: m.role,
              })),
              finalMember: isFinal,
            },
          },
        }
      );
      if (last.outOfBudget) return last;
    }
  }
  return last as TeamRunResult;
}
