import { runWorkspaceAgent } from "./workspaceAgent";
import type { AgentChatRoute, AgentProfileContext } from "./agents";

/**
 * Team orchestration: a team chat gives every roster member one turn per user
 * message, in roster order, inside a single agent run. The first teammate
 * receives the user's real message (persisted once, exactly like any chat);
 * each following teammate receives an internal hand-off note that is never
 * persisted - the chat ledger stays clean (user message, then each agent's
 * attributed reply) while every teammate still sees the full conversation as
 * context. Replies are prefixed `[Name]` so the user can tell who spoke.
 */

/** Run options accepted by runWorkspaceAgent, narrowed for orchestration. */
export type TeamRunOptions = NonNullable<Parameters<typeof runWorkspaceAgent>[3]>;

export type TeamChatRoute = Extract<AgentChatRoute, { kind: "team" }>;

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
}): string {
  const { member, route, teammateNames, isFinal } = input;
  const others = teammateNames.filter(name => name !== member.name);
  return [
    `You are ${member.name}, taking your turn in this agent team chat.`,
    `Team goal: ${route.goal}.`,
    others.length
      ? `Your teammates on this chat: ${others.join(", ")}. Their earlier replies are in the conversation above.`
      : "",
    isFinal
      ? "You are the last teammate this turn: synthesize the team's combined work into one clear final reply to the user, then call end_turn."
      : "Do your part of the goal now, then call end_turn with your contribution - the teammates after you continue right away.",
  ]
    .filter(Boolean)
    .join(" ");
}

type TeamRunResult = Awaited<ReturnType<typeof runWorkspaceAgent>>;

/**
 * Runs one full team turn: every roster member contributes once, in order,
 * against the shared run deadline. The result is the final teammate's run (or
 * an earlier one that ran out of budget - the loop stops there so the shared
 * serverless budget is never blown by starting another member).
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
  let last: TeamRunResult | undefined;
  for (let index = 0; index < roster.length; index += 1) {
    const member = roster[index];
    const isFirst = index === 0;
    const isFinal = index === roster.length - 1;
    last = await runWorkspaceAgent(
      ownerId,
      chatId,
      isFirst
        ? content
        : teamTurnPrompt({ member, route, teammateNames, isFinal }),
      {
        ...options,
        // Only the first teammate writes the user's message; later hand-off
        // notes stay out of the ledger.
        persistUserMessage: isFirst,
        agentChat: {
          profile: member,
          team: {
            goal: route.goal,
            roster: roster.map(m => ({ id: m.id, name: m.name, role: m.role })),
            finalMember: isFinal,
          },
        },
      }
    );
    if (last.outOfBudget) break;
  }
  return last as TeamRunResult;
}
