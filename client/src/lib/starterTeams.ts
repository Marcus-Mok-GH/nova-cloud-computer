import {
  listPublicAgents,
  type PublicAgent,
  type PublicTeam,
} from "@shared/publicAgents";

/**
 * Resolves a starter team's roster into agent ids, in turn order, creating
 * every member the account does not hold yet - so one click lands a working
 * team instead of a roster the user has to assemble by hand.
 *
 * The create call is injected rather than imported, which keeps this a plain
 * async function a unit test can drive without a tRPC mock. `owned` is keyed
 * by lowercased name, and is updated as members are created, so a duplicated
 * name in a roster resolves to one agent rather than a conflict on the
 * second create. A member the catalogue does not know throws instead of
 * silently dropping out of the roster - a team missing a teammate is worse
 * than a failed start.
 */
export async function resolveRosterIds(
  team: PublicTeam,
  owned: ReadonlyMap<string, number>,
  create: (agent: PublicAgent) => Promise<{ id: number }>
): Promise<number[]> {
  const ids: number[] = [];
  const seen = new Map(owned);

  for (const member of team.members) {
    const existing = seen.get(member.toLowerCase());
    if (existing !== undefined) {
      ids.push(existing);
      continue;
    }
    const catalogue = listPublicAgents().find(
      agent => agent.name.toLowerCase() === member.toLowerCase()
    );
    if (!catalogue) throw new Error(`${member} is not a starter agent.`);
    const created = await create(catalogue);
    ids.push(created.id);
    // Keyed on the name we sent, which is the name the create returned.
    seen.set(catalogue.name.toLowerCase(), created.id);
  }

  return ids;
}
