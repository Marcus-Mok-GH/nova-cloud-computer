import { describe, expect, it } from "vitest";
import {
  PUBLIC_AGENTS,
  PUBLIC_TEAMS,
  listPublicAgents,
  listPublicTeams,
} from "./publicAgents";

/**
 * The limits come from the server's own inputs (server/routers.ts): an agent
 * name <= 80, a role <= 120, instructions <= 4000, a wallet budget of 0 to
 * 100000 credits; a team name <= 160, a goal <= 2000, two to eight members.
 * An entry that breaks one of those is rejected by the create endpoint, so
 * the catalogue would offer something that cannot be added.
 */
const LIMITS = {
  agentName: 80,
  role: 120,
  instructions: 4000,
  budget: 100_000,
  teamName: 160,
  goal: 2000,
  teamMin: 2,
  teamMax: 8,
} as const;

describe("the starter agent catalogue", () => {
  it("ships every entry in the shape agents.create accepts", () => {
    for (const agent of PUBLIC_AGENTS) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.name).toBe(agent.name.trim());
      expect(agent.name.length).toBeLessThanOrEqual(LIMITS.agentName);
      expect(agent.role.length).toBeGreaterThan(0);
      expect(agent.role).toBe(agent.role.trim());
      expect(agent.role.length).toBeLessThanOrEqual(LIMITS.role);
      expect(agent.instructions.length).toBeGreaterThan(0);
      expect(agent.instructions.length).toBeLessThanOrEqual(
        LIMITS.instructions
      );
      expect(Number.isInteger(agent.walletBudgetCredits)).toBe(true);
      expect(agent.walletBudgetCredits).toBeGreaterThanOrEqual(0);
      expect(agent.walletBudgetCredits).toBeLessThanOrEqual(LIMITS.budget);
    }
  });

  it("keeps names unique, because an add is keyed by name", () => {
    const names = PUBLIC_AGENTS.map(agent => agent.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("stays a starter set - the builders are the real offer", () => {
    expect(PUBLIC_AGENTS.length).toBeGreaterThan(1);
    expect(PUBLIC_AGENTS.length).toBeLessThanOrEqual(6);
  });

  it("hands out copies, so a caller cannot rewrite the shipped list", () => {
    const list = listPublicAgents();
    list.pop();
    list[0].name = "rewritten";
    expect(listPublicAgents()).toEqual(PUBLIC_AGENTS);
    expect(listPublicAgents().length).toBe(PUBLIC_AGENTS.length);
  });
});

describe("the starter teams", () => {
  it("ships every entry in the shape createTeam accepts", () => {
    for (const team of PUBLIC_TEAMS) {
      expect(team.name.length).toBeGreaterThan(0);
      expect(team.name).toBe(team.name.trim());
      expect(team.name.length).toBeLessThanOrEqual(LIMITS.teamName);
      expect(team.goal.length).toBeGreaterThan(0);
      expect(team.goal).toBe(team.goal.trim());
      expect(team.goal.length).toBeLessThanOrEqual(LIMITS.goal);
      expect(team.members.length).toBeGreaterThanOrEqual(LIMITS.teamMin);
      expect(team.members.length).toBeLessThanOrEqual(LIMITS.teamMax);
    }
  });

  it("rosters only agents that ship in the catalogue, with no duplicates", () => {
    const catalogue = new Set(
      PUBLIC_AGENTS.map(agent => agent.name.toLowerCase())
    );
    for (const team of PUBLIC_TEAMS) {
      for (const member of team.members) {
        expect(catalogue.has(member.toLowerCase())).toBe(true);
      }
      expect(new Set(team.members.map(m => m.toLowerCase())).size).toBe(
        team.members.length
      );
    }
  });

  it("keeps team names unique", () => {
    const names = PUBLIC_TEAMS.map(team => team.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("hands out copies, members included", () => {
    const teams = listPublicTeams();
    const first = teams[0];
    // The outer array and each members array are the caller's to rewrite...
    teams.splice(0, 1);
    first.goal = "rewritten";
    expect(first.members).not.toBe(PUBLIC_TEAMS[0].members);
    // ...without touching what the next caller is handed.
    expect(listPublicTeams()).toEqual(PUBLIC_TEAMS);
    expect(listPublicTeams()[0].members).not.toBe(PUBLIC_TEAMS[0].members);
  });
});
