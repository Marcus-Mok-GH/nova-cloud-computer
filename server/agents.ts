import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, getOrCreateWorkspace, getChatForUser, getUserIdentityForUser } from "./db";
import {
  AgentMailError,
  createAgentMailInbox,
  getAgentMailMessage,
  isAgentMailConfigured,
  listAgentMailMessages,
  normalizeEmailAddress,
  sendAgentMailMessage,
  type AgentMailInboundEvent,
} from "./agentmail";
import {
  agentApprovals,
  agentEmails,
  agentProfiles,
  chatAgents,
  chats,
  workspaces,
  type AgentApprovalRow,
  type AgentProfileRow,
} from "../drizzle/schema";
import { newChatId } from "./chatId";

/**
 * Personal agents (Nova's Cue-style agent layer). Every agent belongs to one
 * workspace and carries:
 *
 * - a role and instructions (what it is for),
 * - a Nova-native identity: an internal email alias and a virtual phone
 *   handle (no third-party telephony/mail - both are workspace-local),
 * - a spending wallet (a credit budget the user grants; purchases are only
 *   carried out after the user approves them in the Agents page),
 * - its own memory scope (see memories.ts) and its own chats.
 *
 * All accessors are owner-scoped through the owner's workspace, matching the
 * tenancy rules used across db.ts.
 */

/** How many credits a new agent's wallet starts with. */
export const DEFAULT_AGENT_WALLET_CREDITS = 500;
/** Largest single purchase an agent may request, in credits. */
export const MAX_PURCHASE_CREDITS = 100_000;
/** How many of each approval state ride along in the agent's system prompt. */
const PROMPT_PENDING_APPROVALS = 5;
const PROMPT_DECIDED_APPROVALS = 3;

/** The identity/.wallet context a run needs for one agent. */
export type AgentProfileContext = {
  id: number;
  name: string;
  role: string | null;
  instructions: string | null;
  emailAlias: string;
  /** Real AgentMail address once provisioned; null falls back to the alias. */
  agentmailAddress?: string | null;
  phoneHandle: string;
  /** Granted budget in credits; null means the wallet has no cap at all. */
  walletBudgetCredits: number | null;
  walletSpentCredits: number;
};

/** How a chat is served: ordinary Nova, one personal agent, or a team roster. */
export type AgentChatRoute =
  | { kind: "plain" }
  | { kind: "personal"; profile: AgentProfileContext }
  | { kind: "team"; goal: string; roster: AgentProfileContext[] };

/** Result of a gated (approval-required) action the agent requested. */
export type GatedActionResult =
  | { ok: true; approvalId: number; message: string }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for tests)                                   */
/* ------------------------------------------------------------------ */

/** URL/name-safe slug for an agent name; falls back for non-Latin names. */
export function slugifyAgentName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "agent";
}

/**
 * A fresh Nova-internal alias, e.g. `mira-4f2a@nova.local`. `.local` is not
 * routable on the public internet, which is exactly the point: this identity
 * is workspace-local until a real mail provider is ever connected.
 */
export function agentEmailAliasFor(name: string, suffix: string): string {
  return `${slugifyAgentName(name)}-${suffix}@nova.local`;
}

/**
 * The address an agent sends mail from: its real AgentMail inbox once
 * provisioned, otherwise the Nova-internal alias. Centralized so the prompt,
 * the approval UI and delivery all agree on the same address.
 */
export function agentAddressFor(agent: {
  emailAlias: string;
  agentmailAddress?: string | null;
}): string {
  return agent.agentmailAddress?.trim() || agent.emailAlias;
}

/** Minimal shape check for a routable email address (deliberately permissive). */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Provisions a real AgentMail inbox for a new agent. Best-effort: when
 * AgentMail is not configured, or the provider call fails, the agent keeps
 * its Nova-internal alias and mail falls back to the internal mailbox - agent
 * creation must never fail on a third-party outage.
 */
async function provisionAgentMailInbox(
  name: string,
  suffix: string,
  workspaceId: number
): Promise<{ inboxId: string; address: string } | null> {
  if (!isAgentMailConfigured()) return null;
  const username = `${slugifyAgentName(name)}-${suffix}`.slice(0, 60);
  try {
    const inbox = await createAgentMailInbox({
      username,
      displayName: name,
      // The workspace id makes the idempotency key globally unique, so a retry
      // (or a name clash across workspaces) can never resolve to another
      // workspace's inbox.
      clientId: `nova-${workspaceId}-${username}`,
    });
    return { inboxId: inbox.inboxId, address: inbox.address };
  } catch (error) {
    console.warn(
      "[AgentMail] Could not provision an inbox:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Makes sure an agent has a real AgentMail inbox, provisioning and persisting
 * one for agents that predate AgentMail. Best-effort: on any failure the
 * agent is returned unchanged with its Nova-internal alias.
 */
async function ensureAgentMailInbox(
  agent: AgentProfileRow
): Promise<AgentProfileRow> {
  if (!isAgentMailConfigured() || agent.agentmailInboxId) return agent;
  const db = await getDb();
  if (!db) return agent;
  // Reuse the alias's random suffix as the mailbox username, so the AgentMail
  // address mirrors the Nova-internal handle (`mira-4f2a@...`).
  const suffix =
    agent.emailAlias.split("@")[0]?.split("-").pop() ||
    Math.random().toString(16).slice(2, 6);
  const inbox = await provisionAgentMailInbox(agent.name, suffix, agent.workspaceId);
  if (!inbox) return agent;
  const [updated] = await db
    .update(agentProfiles)
    .set({
      agentmailInboxId: inbox.inboxId,
      agentmailAddress: inbox.address,
      updatedAt: new Date(),
    })
    .where(eq(agentProfiles.id, agent.id))
    .returning();
  return updated?.id
    ? updated
    : {
        ...agent,
        agentmailInboxId: inbox.inboxId,
        agentmailAddress: inbox.address,
      };
}

/** Outcome of an AgentMail mailbox backfill run. */
export type AgentMailBackfillSummary = {
  examined: number;
  provisioned: number;
  failed: number;
};

/**
 * Gives every agent that does not have one yet a real AgentMail inbox, across
 * all workspaces - swapping the non-routable `@nova.local` alias of agents
 * created before AgentMail was wired up. Safe to rerun: only rows without an
 * inbox id are selected.
 */
export async function backfillAgentMailInboxes(): Promise<AgentMailBackfillSummary> {
  const db = await getDb();
  if (!db) return { examined: 0, provisioned: 0, failed: 0 };
  if (!isAgentMailConfigured()) {
    throw new Error(
      "AGENTMAIL_API_KEY is not configured, so AgentMail inboxes cannot be provisioned."
    );
  }
  const rows = await db
    .select()
    .from(agentProfiles)
    .where(isNull(agentProfiles.agentmailInboxId));
  let provisioned = 0;
  let failed = 0;
  for (const row of rows) {
    const updated = await ensureAgentMailInbox(row);
    if (updated.agentmailInboxId) provisioned += 1;
    else failed += 1;
  }
  return { examined: rows.length, provisioned, failed };
}

/**
 * A fictional virtual phone handle in the reserved +1-555-01XX range (the
 * range reserved for fiction - it can never dial a real subscriber).
 */
export function agentPhoneHandleFor(): string {
  const block = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");
  return `+1-555-01${block}`;
}

/**
 * Credits left in an agent's wallet (never negative). An uncapped wallet -
 * `walletBudgetCredits === null` - always has room, so it reports Infinity.
 */
export function walletRemainingCredits(agent: {
  walletBudgetCredits: number | null;
  walletSpentCredits: number;
}): number {
  if (agent.walletBudgetCredits === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, agent.walletBudgetCredits - agent.walletSpentCredits);
}

/** Drizzle wraps the database error; walk the cause chain for Postgres 23505. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = (current as Error & { code?: unknown }).code;
    if (code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class AgentNameTakenError extends Error {
  constructor() {
    super("That agent name is already taken in this workspace.");
    this.name = "AgentNameTakenError";
  }
}

export function toProfileContext(row: AgentProfileRow): AgentProfileContext {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    instructions: row.instructions,
    emailAlias: row.emailAlias,
    agentmailAddress: row.agentmailAddress,
    phoneHandle: row.phoneHandle,
    walletBudgetCredits: row.walletBudgetCredits,
    walletSpentCredits: row.walletSpentCredits,
  };
}

/* ------------------------------------------------------------------ */
/* Agent CRUD                                                          */
/* ------------------------------------------------------------------ */

export async function listAgentsForUser(ownerId: number): Promise<AgentProfileRow[]> {
  const db = await getDb();
  if (!db) return [];
  const workspace = await getOrCreateWorkspace(ownerId);
  return db
    .select()
    .from(agentProfiles)
    .where(eq(agentProfiles.workspaceId, workspace.id))
    .orderBy(asc(agentProfiles.createdAt));
}

export async function getAgentForUser(
  ownerId: number,
  agentId: number
): Promise<AgentProfileRow | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db
    .select()
    .from(agentProfiles)
    .where(
      and(eq(agentProfiles.id, agentId), eq(agentProfiles.workspaceId, workspace.id))
    )
    .limit(1);
  return rows[0];
}

/** Creates an agent with a freshly minted Nova-native identity. */
export async function createAgentForUser(
  ownerId: number,
  input: {
    name: string;
    role?: string | null;
    instructions?: string | null;
    /** null grants an unlimited wallet; undefined keeps the default budget. */
    walletBudgetCredits?: number | null;
  }
): Promise<AgentProfileRow | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const workspace = await getOrCreateWorkspace(ownerId);
  const name = input.name.trim().slice(0, 80);
  const budget =
    input.walletBudgetCredits === undefined
      ? DEFAULT_AGENT_WALLET_CREDITS
      : input.walletBudgetCredits === null
        ? null
        : Math.max(
            0,
            Math.min(MAX_PURCHASE_CREDITS, Math.trunc(input.walletBudgetCredits))
          );
  // The alias carries a random suffix, so a collision is astronomically
  // unlikely - retry a few times anyway to ride out a lost race. The inbox is
  // provisioned once, before the insert, so a retry never creates a second one.
  const suffix = Math.random().toString(16).slice(2, 6);
  const inbox = await provisionAgentMailInbox(name, suffix, workspace.id);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [created] = await db
        .insert(agentProfiles)
        .values({
          workspaceId: workspace.id,
          name,
          role: input.role?.trim().slice(0, 120) || null,
          instructions: input.instructions?.trim().slice(0, 4000) || null,
          emailAlias: agentEmailAliasFor(name, suffix),
          agentmailInboxId: inbox?.inboxId ?? null,
          agentmailAddress: inbox?.address ?? null,
          phoneHandle: agentPhoneHandleFor(),
          walletBudgetCredits: budget,
          walletSpentCredits: 0,
        })
        .returning();
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // 23505 here is the per-workspace name index (alias collisions retry
      // silently too); surface a name clash as a typed error for the router.
      if (attempt === 4) throw new AgentNameTakenError();
    }
  }
  return undefined;
}

export async function updateAgentForUser(
  ownerId: number,
  agentId: number,
  input: {
    name?: string;
    role?: string | null;
    instructions?: string | null;
    /** null lifts the cap entirely, making the wallet unlimited. */
    walletBudgetCredits?: number | null;
  }
): Promise<AgentProfileRow | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const existing = await getAgentForUser(ownerId, agentId);
  if (!existing) return undefined;
  const updateSet: Partial<AgentProfileRow> = { updatedAt: new Date() };
  if (input.name !== undefined) updateSet.name = input.name.trim().slice(0, 80);
  if (input.role !== undefined)
    updateSet.role = input.role?.trim().slice(0, 120) || null;
  if (input.instructions !== undefined)
    updateSet.instructions = input.instructions?.trim().slice(0, 4000) || null;
  if (input.walletBudgetCredits !== undefined) {
    // null means "no cap": the wallet becomes unlimited. A concrete budget may
    // never drop below what the agent has already spent - that would silently
    // overdraw the wallet. The floor is applied inside the UPDATE against the
    // row's *current* spending, so an approval debiting concurrently can't
    // leave a cap below what was spent (a stale read here would).
    updateSet.walletBudgetCredits =
      input.walletBudgetCredits === null
        ? null
        : (sql`GREATEST(${agentProfiles.walletSpentCredits}, ${Math.max(
            0,
            Math.min(MAX_PURCHASE_CREDITS, Math.trunc(input.walletBudgetCredits))
          )})` as unknown as number);
  }
  try {
    const rows = await db
      .update(agentProfiles)
      .set(updateSet)
      .where(
        and(
          eq(agentProfiles.id, agentId),
          eq(agentProfiles.workspaceId, existing.workspaceId)
        )
      )
      .returning();
    return rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) throw new AgentNameTakenError();
    throw error;
  }
}

/**
 * Removes an agent. Its memories and team memberships cascade away; its
 * personal chat falls back to an ordinary Nova conversation (chats.agentId
 * is SET NULL), so history is never destroyed by deleting an agent.
 */
export async function deleteAgentForUser(
  ownerId: number,
  agentId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const existing = await getAgentForUser(ownerId, agentId);
  if (!existing) return false;
  await db
    .delete(agentProfiles)
    .where(eq(agentProfiles.id, existing.id))
    .returning({ id: agentProfiles.id });
  return true;
}

/* ------------------------------------------------------------------ */
/* Chats: 1:1 agent conversations and team chats                       */
/* ------------------------------------------------------------------ */

/** Opens (or reuses) the personal conversation for one agent. */
export async function startAgentChatForUser(
  ownerId: number,
  agentId: number
): Promise<(typeof chats.$inferSelect) | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const agent = await getAgentForUser(ownerId, agentId);
  if (!agent) return undefined;
  const existing = await db
    .select()
    .from(chats)
    .where(and(eq(chats.workspaceId, agent.workspaceId), eq(chats.agentId, agent.id)))
    .orderBy(desc(chats.updatedAt))
    .limit(1);
  if (existing[0]) return existing[0];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [created] = await db
        .insert(chats)
        .values({
          id: newChatId(),
          workspaceId: agent.workspaceId,
          title: `Chat with ${agent.name}`,
          kind: "personal",
          agentId: agent.id,
        })
        .returning();
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return undefined;
}

/**
 * Creates a team chat: several agents in one group conversation with a shared
 * goal, taking their turns in roster order.
 */
export async function createTeamChatForUser(
  ownerId: number,
  input: { name: string; goal: string; agentIds: number[] }
): Promise<
  | { ok: true; chat: typeof chats.$inferSelect; members: AgentProfileRow[] }
  | { ok: false; error: string }
> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Nova could not reach your workspace data." };
  const workspace = await getOrCreateWorkspace(ownerId);
  const wanted = Array.from(new Set(input.agentIds));
  if (wanted.length < 2) {
    return { ok: false, error: "A team needs at least two agents." };
  }
  const rows = await db
    .select()
    .from(agentProfiles)
    .where(
      and(
        eq(agentProfiles.workspaceId, workspace.id),
        inArray(agentProfiles.id, wanted)
      )
    );
  const members = wanted
    .map(id => rows.find(row => row.id === id))
    .filter((row): row is AgentProfileRow => Boolean(row));
  if (members.length !== wanted.length) {
    return { ok: false, error: "One of those agents no longer exists." };
  }
  const name = input.name.trim().slice(0, 160) || "Agent team";
  const goal = input.goal.trim().slice(0, 2000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [chat] = await db
        .insert(chats)
        .values({
          id: newChatId(),
          workspaceId: workspace.id,
          title: name,
          kind: "team",
          teamGoal: goal,
        })
        .returning();
      if (!chat) return { ok: false, error: "Nova could not create that team." };
      for (let position = 0; position < members.length; position += 1) {
        await db
          .insert(chatAgents)
          .values({ chatId: chat.id, agentId: members[position].id, position });
      }
      return { ok: true, chat, members };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return { ok: false, error: "Nova could not create that team." };
}

/** The workspace's agent-owned conversations (1:1 chats and teams). */
export async function listAgentChatsForUser(ownerId: number): Promise<
  Array<{
    id: string;
    title: string;
    kind: "personal" | "team";
    goal: string | null;
    agentId: number | null;
    members: Array<{ id: number; name: string; role: string | null }>;
    updatedAt: Date;
  }>
> {
  const db = await getDb();
  if (!db) return [];
  const workspace = await getOrCreateWorkspace(ownerId);
  const chatRows = await db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.workspaceId, workspace.id),
        or(eq(chats.kind, "team"), sql`${chats.agentId} is not null`)
      )
    )
    .orderBy(desc(chats.updatedAt));
  if (!chatRows.length) return [];
  const rosterRows = await db
    .select()
    .from(chatAgents)
    .where(
      inArray(
        chatAgents.chatId,
        chatRows.map(chat => chat.id)
      )
    )
    .orderBy(asc(chatAgents.position));
  const agents = await listAgentsForUser(ownerId);
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  return chatRows.map(chat => {
    const members =
      chat.kind === "team"
        ? rosterRows
            .filter(row => row.chatId === chat.id)
            .map(row => agentById.get(row.agentId))
            .filter((agent): agent is AgentProfileRow => Boolean(agent))
            .map(agent => ({ id: agent.id, name: agent.name, role: agent.role }))
        : chat.agentId && agentById.has(chat.agentId)
          ? [
              {
                id: (agentById.get(chat.agentId) as AgentProfileRow).id,
                name: (agentById.get(chat.agentId) as AgentProfileRow).name,
                role: (agentById.get(chat.agentId) as AgentProfileRow).role,
              },
            ]
          : [];
    return {
      id: chat.id,
      title: chat.title,
      kind: chat.kind as "personal" | "team",
      goal: chat.teamGoal,
      agentId: chat.agentId,
      members,
      updatedAt: chat.updatedAt,
    };
  });
}

/**
 * Resolves how a chat should be served by the agent runtime: ordinary Nova,
 * one personal agent, or a team roster in turn order. Unknown chats degrade
 * to `plain`, so a race (deleted agent, missing roster) never blocks chat.
 */
export async function getAgentChatRoute(
  ownerId: number,
  chatId: string
): Promise<AgentChatRoute> {
  const chat = await getChatForUser(ownerId, chatId).catch(() => undefined);
  if (!chat) return { kind: "plain" };
  if (chat.kind === "team") {
    const db = await getDb();
    if (!db) return { kind: "plain" };
    const rosterRows = await db
      .select()
      .from(chatAgents)
      .where(eq(chatAgents.chatId, chat.id))
      .orderBy(asc(chatAgents.position));
    if (!rosterRows.length) return { kind: "plain" };
    const profileRows = await db
      .select()
      .from(agentProfiles)
      .where(
        and(
          eq(agentProfiles.workspaceId, chat.workspaceId),
          inArray(
            agentProfiles.id,
            rosterRows.map(row => row.agentId)
          )
        )
      );
    const byId = new Map(profileRows.map(row => [row.id, row]));
    const roster = rosterRows
      .map(row => byId.get(row.agentId))
      .filter((row): row is AgentProfileRow => Boolean(row))
      .map(toProfileContext);
    if (!roster.length) return { kind: "plain" };
    return {
      kind: "team",
      goal: chat.teamGoal?.trim() || "the shared goal of this team",
      roster,
    };
  }
  if (chat.agentId) {
    const profile = await getAgentForUser(ownerId, chat.agentId);
    if (profile) return { kind: "personal", profile: toProfileContext(profile) };
  }
  return { kind: "plain" };
}

/* ------------------------------------------------------------------ */
/* Approval-gated actions                                              */
/* ------------------------------------------------------------------ */

/** The agent asks to spend wallet credits; the user must approve it first. */
export async function requestWalletPurchaseApproval(
  ownerId: number,
  input: {
    agentId: number;
    chatId?: string | null;
    item: string;
    amountCredits: number;
    note?: string | null;
  }
): Promise<GatedActionResult> {
  const agent = await getAgentForUser(ownerId, input.agentId);
  if (!agent) return { ok: false, error: "That agent no longer exists." };
  const amount = Math.trunc(input.amountCredits);
  if (!Number.isFinite(amount) || amount < 1 || amount > MAX_PURCHASE_CREDITS) {
    return {
      ok: false,
      error: `The amount must be between 1 and ${MAX_PURCHASE_CREDITS} credits.`,
    };
  }
  const item = input.item.trim().slice(0, 240);
  if (!item) return { ok: false, error: "A purchase needs an item description." };
  const remaining = walletRemainingCredits(agent);
  if (amount > remaining) {
    return {
      ok: false,
      error: `Over budget: "${item}" costs ${amount} credits but only ${remaining} of ${agent.walletBudgetCredits} remain in ${agent.name}'s wallet.`,
    };
  }
  // An unlimited wallet (budget null) never hits the check above.
  const db = await getDb();
  if (!db) return { ok: false, error: "Nova could not reach your workspace data." };
  const [approval] = await db
    .insert(agentApprovals)
    .values({
      workspaceId: agent.workspaceId,
      ownerId,
      agentId: agent.id,
      chatId: input.chatId ?? null,
      action: "wallet_purchase",
      params: {
        item,
        amountCredits: amount,
        ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
      },
      status: "pending",
    })
    .returning();
  if (!approval) return { ok: false, error: "Nova could not record that request." };
  return {
    ok: true,
    approvalId: approval.id,
    message: `Approval #${approval.id} is pending: the user must confirm purchases in Nova's Agents page before any credits are spent. Nothing has been paid yet - tell the user a purchase of ${amount} credits for "${item}" is waiting for their approval, then end your turn.`,
  };
}

/** The agent asks to send mail from its identity; also user-gated. */
export async function requestAgentEmailApproval(
  ownerId: number,
  input: {
    agentId: number;
    chatId?: string | null;
    to: string;
    subject: string;
    body: string;
  }
): Promise<GatedActionResult> {
  const existingAgent = await getAgentForUser(ownerId, input.agentId);
  if (!existingAgent) return { ok: false, error: "That agent no longer exists." };
  // Give a pre-AgentMail agent its real inbox before it sends for the first time.
  const agent = await ensureAgentMailInbox(existingAgent);
  const to = input.to.trim().toLowerCase();
  const subject = input.subject.trim().slice(0, 240);
  const body = input.body.trim();
  if (!to) return { ok: false, error: 'A recipient is required - an agent alias, an email address, or "user" for the workspace owner.' };
  if (!subject) return { ok: false, error: "The email needs a subject." };
  if (!body) return { ok: false, error: "The email needs a body." };
  // Resolution order: the workspace owner ("user"), a teammate by its Nova
  // alias or its real AgentMail address, then any external address. Teammates
  // are delivered to their real inbox when they have one; external addresses
  // need AgentMail, since the internal mailbox cannot reach the internet.
  let toAgentId: number | null = null;
  let toAddress: string | null = null;
  if (to === "user") {
    const identity = await getUserIdentityForUser(ownerId);
    toAddress = identity.email ? normalizeEmailAddress(identity.email) : null;
  } else {
    const peers = await listAgentsForUser(ownerId);
    const target = peers.find(
      peer =>
        peer.emailAlias.toLowerCase() === to ||
        peer.agentmailAddress?.toLowerCase() === to
    );
    if (target) {
      if (target.id === agent.id) {
        return { ok: false, error: "An agent cannot mail itself." };
      }
      toAgentId = target.id;
      toAddress = agentAddressFor(target);
    } else if (isEmailAddress(to) && !to.endsWith(".local")) {
      if (!isAgentMailConfigured()) {
        return {
          ok: false,
          error:
            "That is an external email address, and AgentMail is not configured on this workspace yet - agents can only mail each other or the user until it is.",
        };
      }
      toAddress = to;
    } else {
      return {
        ok: false,
        error: `"${to}" is not a recipient. Use a teammate's address (${peers
          .map(peer => agentAddressFor(peer))
          .join(", ")}), any email address, or "user" for the workspace owner.`,
      };
    }
  }
  const db = await getDb();
  if (!db) return { ok: false, error: "Nova could not reach your workspace data." };
  const [approval] = await db
    .insert(agentApprovals)
    .values({
      workspaceId: agent.workspaceId,
      ownerId,
      agentId: agent.id,
      chatId: input.chatId ?? null,
      action: "send_email",
      params: { to, toAgentId, toAddress, subject, body: body.slice(0, 8000) },
      status: "pending",
    })
    .returning();
  if (!approval) return { ok: false, error: "Nova could not record that request." };
  return {
    ok: true,
    approvalId: approval.id,
    message: `Approval #${approval.id} is pending: the user must confirm outbound email in Nova's Agents page before it is delivered. Nothing has been sent yet - tell the user your email to ${to} is waiting for their approval, then end your turn.`,
  };
}

export type ApprovalView = {
  id: number;
  agentId: number;
  agentName: string;
  action: "wallet_purchase" | "send_email";
  summary: string;
  status: "pending" | "executed" | "denied" | "failed";
  resultSummary: string | null;
  chatId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

function approvalSummary(action: string, params: Record<string, unknown>): string {
  if (action === "wallet_purchase") {
    const amount = Number(params.amountCredits ?? 0);
    const item = String(params.item ?? "a purchase");
    const note = params.note ? ` - ${String(params.note)}` : "";
    return `Purchase "${item}" for ${amount} credits${note}`;
  }
  const to = String(params.to ?? "");
  const subject = String(params.subject ?? "");
  return `Email to ${to}: "${subject}"`;
}

function toApprovalView(
  row: AgentApprovalRow,
  agentName: string
): ApprovalView {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName,
    action: row.action as "wallet_purchase" | "send_email",
    summary: approvalSummary(row.action, (row.params ?? {}) as Record<string, unknown>),
    status: row.status,
    resultSummary: row.resultSummary,
    chatId: row.chatId,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

/** Pending decisions first, then the most recently decided ones. */
export async function listApprovalsForUser(ownerId: number): Promise<{
  pending: ApprovalView[];
  recent: ApprovalView[];
}> {
  const db = await getDb();
  if (!db) return { pending: [], recent: [] };
  const [pendingRows, recentRows, agents] = await Promise.all([
    db
      .select()
      .from(agentApprovals)
      .where(and(eq(agentApprovals.ownerId, ownerId), eq(agentApprovals.status, "pending")))
      .orderBy(desc(agentApprovals.createdAt))
      .limit(25),
    db
      .select()
      .from(agentApprovals)
      .where(and(eq(agentApprovals.ownerId, ownerId), ne(agentApprovals.status, "pending")))
      .orderBy(desc(agentApprovals.updatedAt))
      .limit(10),
    listAgentsForUser(ownerId),
  ]);
  const nameById = new Map(agents.map(agent => [agent.id, agent.name]));
  const view = (row: AgentApprovalRow) =>
    toApprovalView(row, nameById.get(row.agentId) ?? "Deleted agent");
  return { pending: pendingRows.map(view), recent: recentRows.map(view) };
}

/**
 * Approves or denies a pending request. The pending row is claimed with a
 * single status-guarded UPDATE first so concurrent approve/deny calls cannot
 * both run side effects (double wallet debit or duplicate email delivery).
 * Approving a purchase then moves credits with a budget-guarded UPDATE;
 * approving an email delivers it to the Nova-internal inbox. Returns null
 * when the approval is missing, not pending, or belongs to someone else.
 */
export async function decideApprovalForUser(
  ownerId: number,
  approvalId: number,
  decision: "approve" | "deny"
): Promise<{ approval: ApprovalView; executed: boolean } | null> {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const pendingClaim = and(
    eq(agentApprovals.id, approvalId),
    eq(agentApprovals.ownerId, ownerId),
    eq(agentApprovals.status, "pending")
  );

  if (decision === "deny") {
    const [denied] = await db
      .update(agentApprovals)
      .set({
        status: "denied",
        resultSummary: "The user declined this request.",
        decidedAt: now,
        updatedAt: now,
      })
      .where(pendingClaim)
      .returning();
    if (!denied) return null;
    const agent = await getAgentForUser(ownerId, denied.agentId);
    return {
      approval: toApprovalView(denied, agent?.name ?? "Deleted agent"),
      executed: false,
    };
  }

  // Claim the pending row before any side effect. Only one concurrent
  // approver wins; losers see null because status is no longer pending.
  const [claimed] = await db
    .update(agentApprovals)
    .set({
      status: "executed",
      resultSummary: "Approval claimed - completing the action.",
      decidedAt: now,
      updatedAt: now,
    })
    .where(pendingClaim)
    .returning();
  if (!claimed) return null;

  const params = (claimed.params ?? {}) as Record<string, unknown>;
  const finish = async (
    status: "executed" | "failed",
    resultSummary: string,
    executed: boolean
  ) => {
    const [updated] = await db
      .update(agentApprovals)
      .set({ status, resultSummary, decidedAt: now, updatedAt: now })
      .where(eq(agentApprovals.id, claimed.id))
      .returning();
    const agent = await getAgentForUser(ownerId, claimed.agentId);
    return updated
      ? {
          approval: toApprovalView(updated, agent?.name ?? "Deleted agent"),
          executed,
        }
      : null;
  };

  if (claimed.action === "wallet_purchase") {
    const amount = Math.trunc(Number(params.amountCredits ?? 0));
    const item = String(params.item ?? "a purchase");
    if (!Number.isFinite(amount) || amount < 1 || amount > MAX_PURCHASE_CREDITS) {
      return finish(
        "failed",
        `Not completed: the purchase amount (${String(params.amountCredits)}) is invalid.`,
        false
      );
    }
    // Atomic guarded debit: the WHERE clause re-checks the budget inside the
    // UPDATE, so two distinct approvals racing each other can never overdraw.
    // A null budget is uncapped, so it skips that comparison entirely (in SQL,
    // `spent + amount <= NULL` would match no row and fail every purchase).
    const debited = await db
      .update(agentProfiles)
      .set({
        walletSpentCredits: sql`${agentProfiles.walletSpentCredits} + ${amount}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentProfiles.id, claimed.agentId),
          sql`(${agentProfiles.walletBudgetCredits} IS NULL OR ${agentProfiles.walletSpentCredits} + ${amount} <= ${agentProfiles.walletBudgetCredits})`
        )
      )
      .returning({ id: agentProfiles.id });
    if (!debited.length) {
      const agent = await getAgentForUser(ownerId, claimed.agentId);
      const remaining = agent ? walletRemainingCredits(agent) : 0;
      return finish(
        "failed",
        `Not completed: the wallet budget is exhausted (${remaining} credits left), so "${item}" could not be paid.`,
        false
      );
    }
    const agent = await getAgentForUser(ownerId, claimed.agentId);
    const remaining = agent ? walletRemainingCredits(agent) : 0;
    const remainNote = Number.isFinite(remaining)
      ? `${remaining} credits remain in the wallet.`
      : `The wallet has no budget cap - ${agent?.walletSpentCredits ?? 0} credits spent so far.`;
    return finish(
      "executed",
      `Approved - paid ${amount} credits for "${item}". ${remainNote}`,
      true
    );
  }

  if (claimed.action === "send_email") {
    // Retry provisioning here too: if the agent still has no inbox, a routable
    // recipient cannot receive the mail and the approval must fail rather than
    // being recorded as a delivered internal message.
    const senderRecord = await getAgentForUser(ownerId, claimed.agentId);
    const sender = senderRecord ? await ensureAgentMailInbox(senderRecord) : null;
    const toAgentId = (params.toAgentId as number | null) ?? null;
    const to = String(params.to ?? "");
    const subject = String(params.subject ?? "(no subject)");
    const body = String(params.body ?? "");
    // Where this mail should actually reach: a teammate's real AgentMail
    // address when it has one, otherwise the address resolved when the
    // request was made (the owner's account email for "user", or an external
    // address). Internal-only recipients keep the workspace mailbox.
    const recipientAgent = toAgentId
      ? await getAgentForUser(ownerId, toAgentId)
      : undefined;
    const providerTarget = toAgentId
      ? recipientAgent?.agentmailAddress?.trim() || null
      : typeof params.toAddress === "string"
        ? params.toAddress
        : null;
    const senderAddress = sender ? agentAddressFor(sender) : "";
    let providerDelivered = false;
    let messageId: string | null = null;
    if (
      isAgentMailConfigured() &&
      sender?.agentmailInboxId &&
      providerTarget &&
      isEmailAddress(providerTarget)
    ) {
      try {
        const sent = await sendAgentMailMessage({
          inboxId: sender.agentmailInboxId,
          to: providerTarget,
          subject,
          text: body,
        });
        messageId = sent.messageId || null;
        providerDelivered = true;
      } catch (error) {
        const message =
          error instanceof AgentMailError
            ? error.message
            : "the mail provider could not be reached";
        return finish("failed", `Approved, but delivery failed - ${message}`, false);
      }
    }
    if (providerTarget && isEmailAddress(providerTarget) && !providerDelivered) {
      return finish(
        "failed",
        "Approved, but delivery failed - the sending agent has no AgentMail inbox, so the mail could not be sent.",
        false
      );
    }
    const [delivered] = await db
      .insert(agentEmails)
      .values({
        workspaceId: claimed.workspaceId,
        fromAgentId: claimed.agentId,
        toAgentId,
        direction: "outbound",
        fromAddress: senderAddress || null,
        toAddress: providerTarget,
        messageId,
        subject,
        body,
      })
      .returning();
    if (!delivered) {
      return finish(
        "failed",
        "Approved, but delivery failed - Nova could not store the email.",
        providerDelivered
      );
    }
    return finish(
      "executed",
      providerDelivered
        ? `Approved - email sent from ${senderAddress} to ${providerTarget}.`
        : `Approved - email delivered to ${to || "the user"}.`,
      true
    );
  }

  return finish(
    "failed",
    `Unknown action "${claimed.action}" - this request could not be executed.`,
    false
  );
}

/**
 * One compact line for the agent's system prompt: what of its own requests is
 * still waiting on the user, and how the last few were decided. The agent
 * never sees raw approval state anywhere else, so this is how it learns that
 * something it asked for was approved, denied, or failed.
 */
export async function describeApprovalsForPrompt(
  ownerId: number,
  agentId: number
): Promise<string> {
  const db = await getDb();
  if (!db) return "approvals: unavailable right now";
  const [pendingRows, decidedRows] = await Promise.all([
    db
      .select()
      .from(agentApprovals)
      .where(and(eq(agentApprovals.ownerId, ownerId), eq(agentApprovals.agentId, agentId), eq(agentApprovals.status, "pending")))
      .orderBy(desc(agentApprovals.createdAt))
      .limit(PROMPT_PENDING_APPROVALS),
    db
      .select()
      .from(agentApprovals)
      .where(and(eq(agentApprovals.ownerId, ownerId), eq(agentApprovals.agentId, agentId), ne(agentApprovals.status, "pending")))
      .orderBy(desc(agentApprovals.updatedAt))
      .limit(PROMPT_DECIDED_APPROVALS),
  ]);
  const parts: string[] = [];
  if (pendingRows.length) {
    parts.push(
      `waiting for the user: ${pendingRows
        .map(row => `#${row.id} ${approvalSummary(row.action, (row.params ?? {}) as Record<string, unknown>)}`)
        .join("; ")}`
    );
  }
  if (decidedRows.length) {
    parts.push(
      `recent decisions: ${decidedRows
        .map(row => `#${row.id} ${row.status} - ${row.resultSummary ?? approvalSummary(row.action, (row.params ?? {}) as Record<string, unknown>)}`)
        .join("; ")}`
    );
  }
  if (!parts.length) return "no approvals are waiting and none were decided yet";
  return parts.join(" | ");
}

/* ------------------------------------------------------------------ */
/* Agent mail: outbound delivery and the workspace mailbox             */
/* ------------------------------------------------------------------ */

/** How many recent messages per inbox an inbound sync considers. */
const INBOUND_SYNC_LIMIT = 20;
/** Largest stored message body (external mail can be arbitrarily large). */
const INBOUND_BODY_LIMIT = 20_000;

export type AgentEmailView = {
  id: number;
  direction: "outbound" | "inbound";
  /** True when an inbound email was answered automatically by the agent. */
  autoReplied: boolean;
  fromAgentId: number | null;
  fromAgentName: string;
  fromAddress: string | null;
  toAgentId: number | null;
  toAgentName: string | null;
  toAddress: string | null;
  subject: string;
  body: string;
  createdAt: Date;
};

/**
 * Pulls new mail from each agent's AgentMail inbox into the workspace mailbox.
 * Best-effort by design: it runs behind the inbox query, and any provider or
 * network failure leaves stored mail untouched rather than breaking the page.
 * Messages are deduped by their AgentMail message id.
 */
export async function syncAgentMailInboxForUser(ownerId: number): Promise<void> {
  if (!isAgentMailConfigured()) return;
  const db = await getDb();
  if (!db) return;
  const agents = await listAgentsForUser(ownerId);
  await Promise.all(
    agents.map(async listedAgent => {
      // Backfill a real inbox for agents that predate AgentMail, then sync it.
      const agent = await ensureAgentMailInbox(listedAgent);
      const inboxId = agent.agentmailInboxId;
      if (!inboxId || !agent.agentmailAddress) return;
      try {
        const messages = await listAgentMailMessages({
          inboxId,
          limit: INBOUND_SYNC_LIMIT,
        });
        if (!messages.length) return;
        const known = await db
          .select({ messageId: agentEmails.messageId })
          .from(agentEmails)
          .where(
            and(
              eq(agentEmails.workspaceId, agent.workspaceId),
              inArray(
                agentEmails.messageId,
                messages.map(message => message.messageId)
              )
            )
          );
        const knownIds = new Set(known.map(row => row.messageId));
        for (const message of messages) {
          if (knownIds.has(message.messageId)) continue;
          // Never store the agent's own outbound mail as an inbound message.
          if (
            normalizeEmailAddress(message.from) ===
            normalizeEmailAddress(agent.agentmailAddress)
          )
            continue;
          // The list response carries only a preview, so always fetch the full
          // body for new messages; fall back to the listed text if it fails.
          const full = await getAgentMailMessage({
            inboxId,
            messageId: message.messageId,
          }).catch(() => null);
          const body = full?.text || message.text;
          await db
            .insert(agentEmails)
            .values({
              workspaceId: agent.workspaceId,
              fromAgentId: null,
              toAgentId: agent.id,
              direction: "inbound",
              fromAddress: normalizeEmailAddress(message.from) || null,
              toAddress: agent.agentmailAddress,
              messageId: message.messageId,
              subject: message.subject.slice(0, 240),
              body: body.slice(0, INBOUND_BODY_LIMIT),
            })
            .onConflictDoNothing();
        }
      } catch (error) {
        console.warn(
          "[AgentMail] Inbound sync failed for",
          agent.name,
          error instanceof Error ? error.message : error
        );
      }
    })
  );
}

/** Don't re-sync the same owner's inbox more often than this. */
const INBOUND_SYNC_MIN_INTERVAL_MS = 15_000;
/** How long the inbox query waits for a sync before returning stored mail. */
const INBOUND_SYNC_BUDGET_MS = 5_000;

/** Last sync attempt per owner, so a busy page does not hammer the provider. */
const lastInboxSyncAt = new Map<number, number>();

/**
 * Runs the inbound sync behind the inbox query without letting a slow
 * provider hold the page open: the work is throttled per owner and raced
 * against a short budget. The sync keeps running in the loose case (its
 * rejection is handled either way); stored mail is always returned, and the
 * next read resumes from where the last sync stopped thanks to message-id
 * dedupe.
 */
async function syncInboxWithinBudget(ownerId: number): Promise<void> {
  const last = lastInboxSyncAt.get(ownerId) ?? 0;
  if (Date.now() - last < INBOUND_SYNC_MIN_INTERVAL_MS) return;
  lastInboxSyncAt.set(ownerId, Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      syncAgentMailInboxForUser(ownerId),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, INBOUND_SYNC_BUDGET_MS);
      }),
    ]);
  } catch {
    // Best-effort: stored mail is returned below regardless.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The workspace mailbox: every agent email (sent and received), newest first. */
export async function listAgentEmailsForUser(ownerId: number): Promise<AgentEmailView[]> {
  const db = await getDb();
  if (!db) return [];
  // Surface replies that arrived since the page last loaded.
  await syncInboxWithinBudget(ownerId);
  const workspace = await getOrCreateWorkspace(ownerId);
  const [emails, agents] = await Promise.all([
    db
      .select()
      .from(agentEmails)
      .where(eq(agentEmails.workspaceId, workspace.id))
      .orderBy(desc(agentEmails.createdAt))
      .limit(50),
    listAgentsForUser(ownerId),
  ]);
  const nameById = new Map(agents.map(agent => [agent.id, agent.name]));
  return emails.map(email => ({
    id: email.id,
    direction: email.direction === "inbound" ? "inbound" : "outbound",
    // Only a delivered reply counts as answered - the claim alone would badge
    // mail whose run or delivery failed.
    autoReplied: email.autoReplySentAt !== null,
    fromAgentId: email.fromAgentId,
    fromAgentName: email.fromAgentId
      ? nameById.get(email.fromAgentId) ?? "Deleted agent"
      : email.fromAddress ?? "External sender",
    fromAddress: email.fromAddress,
    toAgentId: email.toAgentId,
    toAgentName: email.toAgentId ? nameById.get(email.toAgentId) ?? null : null,
    toAddress: email.toAddress,
    subject: email.subject,
    body: email.body,
    createdAt: email.createdAt,
  }));
}

/* ------------------------------------------------------------------ */
/* Inbound auto-reply: webhook delivery -> agent run -> email reply    */
/* ------------------------------------------------------------------ */

/**
 * Finds the agent (and the owner of its workspace) behind one AgentMail
 * inbox. Inbound deliveries identify the inbox, not the tenancy, so this is
 * how a webhook maps back to a workspace owner. Unknown inboxes - another
 * deployment's agent, or one deleted since - resolve to undefined.
 */
export async function findAgentByAgentMailInboxId(
  inboxId: string
): Promise<{ agent: AgentProfileRow; ownerId: number } | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [agent] = await db
    .select()
    .from(agentProfiles)
    .where(eq(agentProfiles.agentmailInboxId, inboxId))
    .limit(1);
  if (!agent) return undefined;
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, agent.workspaceId))
    .limit(1);
  if (!workspace) return undefined;
  return { agent, ownerId: workspace.ownerId };
}

/** Outcome of claiming one inbound email for an automatic reply. */
/** Runaway guard: the most auto-replies one sender can receive per window. */
const AUTO_REPLY_SENDER_LIMIT = 10;
const AUTO_REPLY_WINDOW_MS = 60 * 60 * 1000;

/** True for any address on AgentMail's shared inbox domain. */
function isAgentMailDomainAddress(address: string): boolean {
  return address.toLowerCase().endsWith("@agentmail.to");
}

/** True when the address belongs to an agent of any workspace. */
async function isKnownAgentAddress(address: string): Promise<boolean> {
  if (!address) return false;
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: agentProfiles.id })
    .from(agentProfiles)
    .where(eq(agentProfiles.agentmailAddress, address))
    .limit(1);
  return Boolean(row);
}

/** True when this agent has already auto-replied to `from` too often lately. */
async function hasReachedAutoReplyRateLimit(
  agent: AgentProfileRow,
  from: string
): Promise<boolean> {
  if (!from) return false;
  const db = await getDb();
  if (!db) return false;
  const recent = await db
    .select({ id: agentEmails.id })
    .from(agentEmails)
    .where(
      and(
        eq(agentEmails.workspaceId, agent.workspaceId),
        eq(agentEmails.direction, "outbound"),
        eq(agentEmails.toAddress, from),
        gte(agentEmails.createdAt, new Date(Date.now() - AUTO_REPLY_WINDOW_MS))
      )
    );
  return recent.length >= AUTO_REPLY_SENDER_LIMIT;
}

export type InboundAgentEmailClaim =
  | {
      claimed: true;
      agent: AgentProfileRow;
      ownerId: number;
      event: AgentMailInboundEvent;
      /** The workspace chat the run belongs to (the agent's personal chat). */
      chatId: string;
    }
  | {
      claimed: false;
      reason:
        | "unknown-inbox"
        | "self-sent"
        | "automated-sender"
        | "agent-sender"
        | "rate-limited"
        | "already-replied"
        | "no-chat";
    };

/**
 * Records an inbound email and, when it is safe to answer, atomically claims
 * the one auto-reply it earns.
 *
 * The row is inserted first (deduped by provider message id, so the sync and
 * the webhook can race harmlessly) and the claim is a guarded UPDATE on
 * `autoRepliedAt` - the first delivery wins and a webhook retry sees a
 * non-null mark and stops, which is what makes the reply exactly-once even
 * when Svix redelivers.
 *
 * It is only claimed when answering cannot start a mail loop or let a stranger
 * drive endless runs: the agent's own address, machine-generated mail
 * (out-of-office and auto-responders), any other agent's address, and a sender
 * already answered up to the per-window cap are all recorded but never
 * auto-answered.
 */
export async function claimInboundAgentEmailForAutoReply(
  event: AgentMailInboundEvent
): Promise<InboundAgentEmailClaim> {
  const found = await findAgentByAgentMailInboxId(event.inboxId);
  if (!found) return { claimed: false, reason: "unknown-inbox" };
  const { agent, ownerId } = found;
  const db = await getDb();
  if (!db) return { claimed: false, reason: "unknown-inbox" };
  // The agent's own address is outbound mail, not something to record or
  // answer - the periodic sync skips it the same way.
  if (
    agent.agentmailAddress &&
    normalizeEmailAddress(agent.agentmailAddress) === event.from
  ) {
    return { claimed: false, reason: "self-sent" };
  }
  // Record the mail whether or not it is answered, so the inbox stays complete.
  await db
    .insert(agentEmails)
    .values({
      workspaceId: agent.workspaceId,
      fromAgentId: null,
      toAgentId: agent.id,
      direction: "inbound",
      fromAddress: event.from || null,
      toAddress: agent.agentmailAddress,
      messageId: event.messageId,
      subject: event.subject.slice(0, 240),
      body: event.text.slice(0, INBOUND_BODY_LIMIT),
    })
    .onConflictDoNothing();
  // Loop and abuse guards, all decided before the claim.
  if (event.automated) return { claimed: false, reason: "automated-sender" };
  if (
    isAgentMailDomainAddress(event.from) ||
    (await isKnownAgentAddress(event.from))
  ) {
    return { claimed: false, reason: "agent-sender" };
  }
  if (await hasReachedAutoReplyRateLimit(agent, event.from)) {
    return { claimed: false, reason: "rate-limited" };
  }
  // Resolve the run's chat before claiming, so a missing chat never consumes
  // the one claim and leaves the mail permanently unanswerable.
  const chat = await startAgentChatForUser(ownerId, agent.id);
  if (!chat) return { claimed: false, reason: "no-chat" };
  const claimed = await db
    .update(agentEmails)
    .set({ autoRepliedAt: new Date() })
    .where(
      and(
        eq(agentEmails.messageId, event.messageId),
        eq(agentEmails.direction, "inbound"),
        isNull(agentEmails.autoRepliedAt)
      )
    )
    .returning({ id: agentEmails.id });
  if (!claimed.length) return { claimed: false, reason: "already-replied" };
  return { claimed: true, agent, ownerId, event, chatId: chat.id };
}
