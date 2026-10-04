import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentChatRoute, AgentProfileContext } from "./agents";

const runWorkspaceAgent = vi.fn();
vi.mock("./workspaceAgent", () => ({
  runWorkspaceAgent: (...args: unknown[]) => runWorkspaceAgent(...args),
}));

const { runTeamChatTurns, teamTurnPrompt } = await import("./agentChats");

const profile = (
  id: number,
  name: string,
  role: string | null = null
): AgentProfileContext => ({
  id,
  name,
  role,
  instructions: null,
  emailAlias: `${name.toLowerCase()}-${id}@nova.local`,
  phoneHandle: `+1-555-010${id}`,
  walletBudgetCredits: 500,
  walletSpentCredits: 0,
});

const mira = profile(1, "Mira", "Researcher");
const pip = profile(2, "Pip", "Writer");
const jo = profile(3, "Jo", "Analyst");

const teamRoute = (roster: AgentProfileContext[]): Extract<AgentChatRoute, { kind: "team" }> => ({
  kind: "team",
  goal: "research venues for the New York launch",
  roster,
});

function fakeRunResult(overrides: Record<string, unknown> = {}) {
  return { message: { id: 1, content: "done" }, actions: [], outOfBudget: false, ...overrides };
}

beforeEach(() => {
  runWorkspaceAgent.mockReset();
  runWorkspaceAgent.mockResolvedValue(fakeRunResult());
});

describe("team turn orchestration", () => {
  it("gives every roster member one turn, in order, against the shared options", async () => {
    const options = { channel: "web" as const, deadlineAtMs: 123456 };
    const result = await runTeamChatTurns({
      ownerId: 1,
      chatId: "chat000000000000000001",
      content: "plan our launch event",
      route: teamRoute([mira, pip, jo]),
      options,
    });
    expect(runWorkspaceAgent).toHaveBeenCalledTimes(3);
    const calls = runWorkspaceAgent.mock.calls;

    // First teammate carries the user's real message and persists it.
    expect(calls[0][2]).toBe("plan our launch event");
    expect(calls[0][3]).toMatchObject({
      persistUserMessage: true,
      agentChat: {
        profile: mira,
        team: {
          goal: "research venues for the New York launch",
          finalMember: false,
          roster: [
            { id: 1, name: "Mira" },
            { id: 2, name: "Pip" },
            { id: 3, name: "Jo" },
          ],
        },
      },
      deadlineAtMs: 123456,
      channel: "web",
    });

    // Following teammates get an internal hand-off note, persisted nowhere.
    expect(calls[1][2]).not.toBe("plan our launch event");
    expect(calls[1][2]).toContain("Pip");
    expect(calls[1][2]).toContain("research venues for the New York launch");
    expect(calls[1][3]).toMatchObject({
      persistUserMessage: false,
      agentChat: { profile: pip, team: { finalMember: false } },
    });

    // The last teammate wraps up for the user.
    expect(calls[2][3]).toMatchObject({
      persistUserMessage: false,
      agentChat: { profile: jo, team: { finalMember: true } },
    });
    expect(calls[2][2]).toContain("last teammate");

    // The team's result is the final teammate's run.
    expect(result).toEqual(fakeRunResult());
  });

  it("runs a multi-round discussion and lets only the final turn synthesize", async () => {
    const options = { channel: "web" as const, deadlineAtMs: Date.now() + 200_000 };
    await runTeamChatTurns({
      ownerId: 1,
      chatId: "chat000000000000000001",
      content: "plan our launch event",
      route: teamRoute([mira, pip]),
      options,
    });

    expect(runWorkspaceAgent).toHaveBeenCalledTimes(4);
    const calls = runWorkspaceAgent.mock.calls;

    // Opening round: the first turn carries (and persists) the user message,
    // nobody is "final" yet.
    expect(calls[0][3]).toMatchObject({
      persistUserMessage: true,
      agentChat: { profile: mira, team: { finalMember: false } },
    });
    expect(calls[0][2]).toBe("plan our launch event");
    expect(calls[1][3]).toMatchObject({
      persistUserMessage: false,
      agentChat: { profile: pip, team: { finalMember: false } },
    });
    expect(calls[1][2]).toContain("round 1 of 2");
    expect(calls[1][2]).toContain("opening round");

    // Refinement round: teammates react to each other, and only the last turn
    // of the final round synthesizes for the user.
    expect(calls[2][2]).toContain("round 2 of 2");
    expect(calls[2][2]).toContain("React to your teammates");
    expect(calls[3][3]).toMatchObject({
      persistUserMessage: false,
      agentChat: { profile: pip, team: { finalMember: true } },
    });
    expect(calls[3][2]).toContain("synthesize");
  });

  it("stops the roster when a teammate runs out of budget", async () => {
    runWorkspaceAgent.mockResolvedValueOnce(fakeRunResult({ outOfBudget: true }));
    const result = await runTeamChatTurns({
      ownerId: 1,
      chatId: "chat000000000000000001",
      content: "go",
      route: teamRoute([mira, pip]),
      options: {},
    });
    expect(runWorkspaceAgent).toHaveBeenCalledTimes(1);
    expect(result.outOfBudget).toBe(true);
  });

  it("falls back to a plain run when the roster is empty", async () => {
    await runTeamChatTurns({
      ownerId: 1,
      chatId: "chat000000000000000001",
      content: "hello",
      route: teamRoute([]),
      options: { channel: "web" },
    });
    expect(runWorkspaceAgent).toHaveBeenCalledTimes(1);
    expect(runWorkspaceAgent.mock.calls[0][3]).not.toHaveProperty("agentChat");
  });
});

describe("teamTurnPrompt", () => {
  it("names the goal, the teammates, and whose turn it is", () => {
    const prompt = teamTurnPrompt({
      member: pip,
      route: teamRoute([mira, pip]),
      teammateNames: ["Mira", "Pip"],
      isFinal: false,
      round: 1,
      rounds: 1,
    });
    expect(prompt).toContain("You are Pip");
    expect(prompt).toContain("research venues for the New York launch");
    expect(prompt).toContain("Mira");
    expect(prompt).toContain("end_turn");
    expect(prompt).not.toContain("last teammate");
  });

  it("tells the final teammate to synthesize the answer for the user", () => {
    const prompt = teamTurnPrompt({
      member: pip,
      route: teamRoute([mira, pip]),
      teammateNames: ["Mira", "Pip"],
      isFinal: true,
      round: 2,
      rounds: 2,
    });
    expect(prompt).toContain("last teammate");
    expect(prompt).toContain("synthesize");
  });
});
