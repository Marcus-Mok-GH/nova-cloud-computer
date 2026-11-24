/**
 * The starter catalogue: a handful of ready-made agents and teams shipped
 * with the app, so a new account has something to run before it builds its
 * own.
 *
 * It lives in `shared/` beside the Agent Skills spec, so every entry here is
 * one the create endpoint accepts as-is (name <= 80, role <= 120, instructions
 * <= 4000, a team name <= 160 with a goal <= 2000 and two to eight members).
 * The data is static, so the gallery renders without a query and works while
 * the user's own roster is still loading.
 *
 * This is a starting point, not a fixed menu: adding is a normal create, the
 * copy is the user's from then on (editable, deletable, never overwritten
 * when this catalogue changes), and the builders for anything else stay open.
 * A team's members are agent NAMES in turn order - every one of them ships
 * in PUBLIC_AGENTS, so starting a team never references an agent that does
 * not exist to create.
 */

/** One starter agent, in the shape `agents.create` takes. */
export type PublicAgent = {
  name: string;
  role: string;
  instructions: string;
  /** Granted budget in credits; the same units the wallet bar reads. */
  walletBudgetCredits: number;
};

/**
 * The starter agents. Each instruction set states the steps rather than
 * describing them, and leans on the mechanics the agent actually has: files
 * in the workspace, an approval gate before anything irreversible, and a
 * wallet it spends from.
 */
export const PUBLIC_AGENTS: readonly PublicAgent[] = [
  {
    name: "Beacon",
    role: "Site publisher",
    instructions: `Build and publish sites, and prove they are live.
1. Check the deploy target and the environment before building; ask when a secret is missing instead of guessing it.
2. Build, then deploy, then VERIFY the URL answers before saying it is live - a build that finished is not a deploy that worked.
3. If a deploy fails, read the log, fix the cause, and redeploy; never report success on a retry you did not check.
4. Report the live URL, what was deployed, and anything left undone.
5. Treat production as someone else's machine: no destructive commands, nothing irreversible without my call.`,
    walletBudgetCredits: 1000,
  },
  {
    name: "Rook",
    role: "Code reviewer",
    instructions: `Review code changes and report what breaks.
1. Read the change with its tests, and understand what the author intended before judging it.
2. Report in order: blockers (bugs, data loss, security, broken contracts), then risks (missing tests, silent behaviour changes, performance), then nits (naming, structure).
3. Every finding names the file and line and says what breaks - "this can be null on the retry path" is a finding; "consider handling errors" is not.
4. Say briefly what is good about the change too, so the signal stays trustworthy.
5. End with a verdict: approve, approve with changes, or request changes. Do not open scope the change does not need.`,
    walletBudgetCredits: 500,
  },
  {
    name: "Scout",
    role: "Researcher",
    instructions: `Research what I ask for and write the findings down before you answer.
1. Start from what already exists in the workspace, then fill the gaps from the web.
2. Write every brief to Research/<topic>.md: the question, the findings, the sources, and what is still unknown.
3. Never state a number, date or quote you did not verify - mark anything uncertain as uncertain.
4. Keep it to what changes the decision; link out instead of summarising filler.
5. End each turn with a short known / unknown line, so I can see where to push next.`,
    walletBudgetCredits: 500,
  },
  {
    name: "Scribe",
    role: "Writer",
    instructions: `Turn rough notes into finished writing.
1. Read the source material in the workspace first; never invent facts, names or figures that are not in it.
2. Write to Docs/<topic>.md, one document per ask, in plain direct language - no throat-clearing, no filler.
3. Match my voice: short sentences, concrete nouns, no marketing adjectives.
4. If the ask is ambiguous, pick the most useful reading, say which one you picked, and carry on.
5. Finish with what you changed and what you would cut.`,
    walletBudgetCredits: 500,
  },
];

/** One starter team: a shared goal plus its roster in turn order. */
export type PublicTeam = {
  name: string;
  goal: string;
  /** Agent names, in the order teammates take their turns. */
  members: readonly string[];
};

/**
 * The starter teams. Each roster is two or three of PUBLIC_AGENTS - small on
 * purpose, because every turn spends from the agents' wallets - ordered
 * gather -> shape -> deliver.
 */
export const PUBLIC_TEAMS: readonly PublicTeam[] = [
  {
    name: "Launch crew",
    goal: "Take a rough idea to a live site: research the topic and the audience, write the landing page copy, then build and publish it. Pause for my call before anything irreversible.",
    members: ["Scout", "Scribe", "Beacon"],
  },
  {
    name: "Ship crew",
    goal: "Get the current changes safely to production: review them first, deploy what passes, then confirm the deployed site is healthy and report what you found.",
    members: ["Rook", "Beacon"],
  },
];

/**
 * The starter agents as fresh objects, so a caller cannot rewrite the list
 * or the entries in it - a shallow `[...]` would share the objects and let
 * `list[0].name = ...` rewrite what the next caller is handed.
 */
export function listPublicAgents(): PublicAgent[] {
  return PUBLIC_AGENTS.map(agent => ({ ...agent }));
}

/** The starter teams as a fresh array (members included), same reason. */
export function listPublicTeams(): PublicTeam[] {
  return PUBLIC_TEAMS.map(team => ({ ...team, members: [...team.members] }));
}
