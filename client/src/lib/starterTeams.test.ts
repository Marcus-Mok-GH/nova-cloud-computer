import { describe, expect, it, vi } from "vitest";
import { resolveRosterIds } from "./starterTeams";
import { listPublicAgents, type PublicAgent, type PublicTeam } from "@shared/publicAgents";

const team = (members: string[]): PublicTeam => ({
  name: "Test crew",
  goal: "Do the thing.",
  members,
});

describe("resolveRosterIds", () => {
  it("reuses the agents the roster already holds and creates the rest", async () => {
    let nextId = 900;
    const create = vi.fn(async () => ({ id: (nextId += 1) }));
    // Scout exists; Scribe and Beacon do not.
    const owned = new Map([["scout", 7]]);

    const ids = await resolveRosterIds(team(["Scout", "Scribe", "Beacon"]), owned, create);

    expect(ids).toEqual([7, 901, 902]);
    // Only the missing two are created, with the catalogue's own copy.
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].name).toBe("Scribe");
    expect(create.mock.calls[1][0].name).toBe("Beacon");
    expect(create.mock.calls[0][0].instructions.length).toBeGreaterThan(0);
  });

  it("keeps the roster's turn order", async () => {
    const create = vi.fn(async (agent: PublicAgent) => ({ id: agent.name.length }));
    const ids = await resolveRosterIds(team(["Beacon", "Rook"]), new Map(), create);
    expect(ids).toEqual(["Beacon".length, "Rook".length]);
  });

  it("is case-insensitive, so a roster name matching an agent matches", async () => {
    const create = vi.fn(async () => ({ id: 1 }));
    const ids = await resolveRosterIds(team(["SCOUT"]), new Map([["scout", 42]]), create);
    expect(ids).toEqual([42]);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a duplicate roster member once, not twice", async () => {
    const create = vi.fn(async () => ({ id: 555 }));
    const ids = await resolveRosterIds(team(["Scribe", "Scribe"]), new Map(), create);
    expect(ids).toEqual([555, 555]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("refuses a member the catalogue does not ship rather than dropping it", async () => {
    const create = vi.fn(async () => ({ id: 1 }));
    await expect(
      resolveRosterIds(team(["Nobody"]), new Map(), create)
    ).rejects.toThrow("Nobody is not a starter agent.");
    expect(create).not.toHaveBeenCalled();
  });

  it("every roster name it can be asked for exists in the shipped catalogue", () => {
    const names = new Set(listPublicAgents().map(agent => agent.name.toLowerCase()));
    expect(names.has("scout")).toBe(true);
    expect(names.has("scribe")).toBe(true);
    expect(names.has("rook")).toBe(true);
    expect(names.has("beacon")).toBe(true);
  });
});
