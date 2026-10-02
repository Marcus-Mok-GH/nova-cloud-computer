import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getDb, getOrCreateWorkspace, getChatForUser } from "./db";
import {
  agentApprovals,
  agentEmails,
  agentProfiles,
  chatAgents,
  chats,
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
  phoneHandle: string;
  walletBudgetCredits: number;
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
 * A fictional virtual phone handle in the reserved +1-555-01XX range (the
 * range reserved for fiction - it can never dial a real subscriber).
 */
export function agentPhoneHandleFor(): string {
  const block = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");
  return `+1-555-01${block}`;
}

/** Credits left in an agent's wallet (never negative). */
export function walletRemainingCredits(agent: {
  walletBudgetCredits: number;
  walletSpentCredits: number;
}): number {
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

function toProfileContext(row: AgentProfileRow): AgentProfileContext {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    instructions: row.instructions,
    emailAlias: row.emailAlias,
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
    walletBudgetCredits?: number;
  }
): Promise<AgentProfileRow | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const workspace = await getOrCreateWorkspace(ownerId);
  const name = input.name.trim().slice(0, 80);
  const budget = Math.max(
    0,
    Math.min(MAX_PURCHASE_CREDITS, Math.trunc(input.walletBudgetCredits ?? DEFAULT_AGENT_WALLET_CREDITS))
  );
  // The alias carries a random suffix, so a collision is astronomically
  // unlikely - retry a few times anyway to ride out a lost race.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [created] = await db
        .insert(agentProfiles)
        .values({
          workspaceId: workspace.id,
          name,
          role: input.role?.trim().slice(0, 120) || null,
          instructions: input.instructions?.trim().slice(0, 4000) || null,
          emailAlias: agentEmailAliasFor(
            name,
            Math.random().toString(16).slice(2, 6)
          ),
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
    walletBudgetCredits?: number;
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
    // A budget may never drop below what the agent has already spent - that
    // would silently overdraw the wallet.
    updateSet.walletBudgetCredits = Math.max(
      existing.walletSpentCredits,
      Math.min(MAX_PURCHASE_CREDITS, Math.trunc(input.walletBudgetCredits))
    );
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
  const agent = await getAgentForUser(ownerId, input.agentId);
  if (!agent) return { ok: false, error: "That agent no longer exists." };
  const to = input.to.trim().toLowerCase();
  const subject = input.subject.trim().slice(0, 240);
  const body = input.body.trim();
  if (!to) return { ok: false, error: 'A recipient is required - an agent alias, or "user" for the workspace owner.' };
  if (!subject) return { ok: false, error: "The email needs a subject." };
  if (!body) return { ok: false, error: "The email needs a body." };
  let toAgentId: number | null = null;
  if (to !== "user") {
    const peers = await listAgentsForUser(ownerId);
    const target = peers.find(peer => peer.emailAlias.toLowerCase() === to);
    if (!target) {
      return {
        ok: false,
        error: `No agent in this workspace uses the alias "${to}". Known aliases: ${peers
          .map(peer => peer.emailAlias)
          .join(", ")}, or "user".`,
      };
    }
    if (target.id === agent.id) {
      return { ok: false, error: "An agent cannot mail itself." };
    }
    toAgentId = target.id;
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
      params: { to, toAgentId, subject, body: body.slice(0, 8000) },
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
 * Approves or denies a pending request. Approving a purchase moves the
 * credits (atomically guarded so the wallet can never overdraw); approving
 * an email delivers it to the Nova-internal inbox. Returns null when the
 * approval is missing, not pending, or belongs to someone else.
 */
export async function decideApprovalForUser(
  ownerId: number,
  approvalId: number,
  decision: "approve" | "deny"
): Promise<{ approval: ApprovalView; executed: boolean } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(agentApprovals)
    .where(
      and(
        eq(agentApprovals.id, approvalId),
        eq(agentApprovals.ownerId, ownerId),
        eq(agentApprovals.status, "pending")
      )
    )
    .limit(1);
  const approval = rows[0];
  if (!approval) return null;
  const params = (approval.params ?? {}) as Record<string, unknown>;
  const now = new Date();

  if (decision === "deny") {
    const [updated] = await db
      .update(agentApprovals)
      .set({
        status: "denied",
        resultSummary: "The user declined this request.",
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(agentApprovals.id, approval.id))
      .returning();
    const agent = await getAgentForUser(ownerId, approval.agentId);
    return updated
      ? { approval: toApprovalView(updated, agent?.name ?? "Deleted agent"), executed: false }
      : null;
  }

  if (approval.action === "wallet_purchase") {
    const amount = Math.trunc(Number(params.amountCredits ?? 0));
    const item = String(params.item ?? "a purchase");
    // Atomic guarded debit: the WHERE clause re-checks the budget inside the
    // UPDATE, so two approvals racing each other can never overdraw.
    const claimed = await db
      .update(agentProfiles)
      .set({
        walletSpentCredits: sql`${agentProfiles.walletSpentCredits} + ${amount}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentProfiles.id, approval.agentId),
          sql`${agentProfiles.walletSpentCredits} + ${amount} <= ${agentProfiles.walletBudgetCredits}`
        )
      )
      .returning({ id: agentProfiles.id });
    if (!claimed.length) {
      const agent = await getAgentForUser(ownerId, approval.agentId);
      const remaining = agent ? walletRemainingCredits(agent) : 0;
      const [failed] = await db
        .update(agentApprovals)
        .set({
          status: "failed",
          resultSummary: `Not completed: the wallet budget is exhausted (${remaining} credits left), so "${item}" could not be paid.`,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(agentApprovals.id, approval.id))
        .returning();
      return failed
        ? {
            approval: toApprovalView(failed, agent?.name ?? "Deleted agent"),
            executed: false,
          }
        : null;
    }
    const agent = await getAgentForUser(ownerId, approval.agentId);
    const remaining = agent ? walletRemainingCredits(agent) : 0;
    const [executed] = await db
      .update(agentApprovals)
      .set({
        status: "executed",
        resultSummary: `Approved - paid ${amount} credits for "${item}". ${remaining} credits remain in the wallet.`,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(agentApprovals.id, approval.id))
      .returning();
    return executed
      ? { approval: toApprovalView(executed, agent?.name ?? "Deleted agent"), executed: true }
      : null;
  }

  if (approval.action === "send_email") {
    const [delivered] = await db
      .insert(agentEmails)
      .values({
        workspaceId: approval.workspaceId,
        fromAgentId: approval.agentId,
        toAgentId: (params.toAgentId as number | null) ?? null,
        subject: String(params.subject ?? "(no subject)"),
        body: String(params.body ?? ""),
      })
      .returning();
    const agent = await getAgentForUser(ownerId, approval.agentId);
    const [executed] = await db
      .update(agentApprovals)
      .set({
        status: "executed",
        resultSummary: delivered
          ? `Approved - email delivered to ${String(params.to ?? "the user")}.`
          : "Approved, but delivery failed - Nova could not store the email.",
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(agentApprovals.id, approval.id))
      .returning();
    return executed
      ? { approval: toApprovalView(executed, agent?.name ?? "Deleted agent"), executed: Boolean(delivered) }
      : null;
  }

  // Unknown action: close it out rather than leaving it pending forever.
  const [failed] = await db
    .update(agentApprovals)
    .set({
      status: "failed",
      resultSummary: `Unknown action "${approval.action}" - this request could not be executed.`,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(agentApprovals.id, approval.id))
    .returning();
  const agent = await getAgentForUser(ownerId, approval.agentId);
  return failed
    ? { approval: toApprovalView(failed, agent?.name ?? "Deleted agent"), executed: false }
    : null;
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
/* Nova-internal agent email                                           */
/* ------------------------------------------------------------------ */

export type AgentEmailView = {
  id: number;
  fromAgentId: number;
  fromAgentName: string;
  toAgentId: number | null;
  toAgentName: string | null;
  subject: string;
  body: string;
  createdAt: Date;
};

/** The workspace's internal mailbox: every agent email, newest first. */
export async function listAgentEmailsForUser(ownerId: number): Promise<AgentEmailView[]> {
  const db = await getDb();
  if (!db) return [];
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
    fromAgentId: email.fromAgentId,
    fromAgentName: nameById.get(email.fromAgentId) ?? "Deleted agent",
    toAgentId: email.toAgentId,
    toAgentName: email.toAgentId ? nameById.get(email.toAgentId) ?? null : null,
    subject: email.subject,
    body: email.body,
    createdAt: email.createdAt,
  }));
}
