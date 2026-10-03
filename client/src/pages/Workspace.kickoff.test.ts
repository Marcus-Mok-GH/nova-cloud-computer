import { describe, expect, it } from "vitest";
import { teamPlanKickoff } from "./Workspace";

describe("teamPlanKickoff", () => {
  it("quotes the shared goal and asks for a plan before execution", () => {
    const message = teamPlanKickoff("Plan the New York launch end to end");
    expect(message).toContain(
      "The team's shared goal: Plan the New York launch end to end."
    );
    expect(message).toContain("plan mode");
    expect(message).toContain("assign each task to the teammate");
    expect(message).toContain("Present the plan for my approval before executing");
  });

  it("still produces a valid kickoff when the goal is missing", () => {
    for (const goal of ["", "   "]) {
      const message = teamPlanKickoff(goal);
      expect(message).toContain("Begin the team's shared goal.");
      expect(message).toContain("plan mode");
    }
  });

  it("ignores surrounding whitespace on the goal", () => {
    expect(teamPlanKickoff("  Ship it  ")).toContain(
      "The team's shared goal: Ship it."
    );
  });
});
