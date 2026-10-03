import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentApprovals, agentProfiles, agentEmails } from "../drizzle/schema";

/**
 * Scripted drizzle stand-in: each select/insert/update shifts the next
 * prepared result. The chains agents.ts uses (from/where/orderBy/limit,
 * values/returning, set/where/returning) are all supported; where-clause
 * evaluation belongs to Postgres and is not re-implemented here.
 */
type Row = Record<string, unknown>;

const script = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    selects: [] as Row[][],
    inserts: [] as Row[][],
    updates: [] as Row[][],
    insertCalls: [] as Array<{ table: unknown; values: Row }>,
    updateCalls: [] as Array<{ table: unknown; values: Row; condition: unknown }>,
    reset() {
      this.selects = [];
      this.inserts = [];
      this.updates = [];
      this.insertCalls = [];
      this.updateCalls = [];
    },
  };
  const take = (queue: Row[][], fallback: Row[] = []) =>
    queue.length ? queue.shift()! : fallback;
  const fakeDb = {
    select: () => ({
      from: () => {
        const rows = take(state.selects);
        const chain: any = {
          where: () => chain,
          orderBy: () => chain,
          limit: () => Promise.resolve(rows),
          then: (onF: any, onR: any) => Promise.resolve(rows).then(onF, onR),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Row) => {
        state.insertCalls.push({ table, values });
        const rows = take(state.inserts, [{}]);
        return {
          returning: async () => rows,
          onConflictDoNothing: () => ({
            then: (onF: any, onR: any) => Promise.resolve(rows).then(onF, onR),
          }),
          then: (onF: any, onR: any) => Promise.resolve(rows).then(onF, onR),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: (condition: unknown) => {
          state.updateCalls.push({ table, values, condition });
          const rows = take(state.updates, [{}]);
          return { returning: async () => rows };
        },
      }),
    }),
    delete: () => ({
      where: () => ({ returning: async () => [{ id: 1 }] }),
    }),
  };
  return { state, fakeDb };
});

/** Controllable AgentMail stand-in: no network, records what was provisioned/sent. */
const mail = vi.hoisted(() => ({
  configured: false,
  failCreate: false,
  created: [] as Array<Record<string, unknown>>,
  sent: [] as Array<Record<string, unknown>>,
  listResult: [] as Array<Record<string, unknown>>,
  getResult: { messageId: "", threadId: "", from: "", to: [] as string[], subject: "", text: "", timestamp: new Date() },
  reset() {
    this.configured = false;
    this.failCreate = false;
    this.created = [];
    this.sent = [];
    this.listResult = [];
    this.getResult = { messageId: "", threadId: "", from: "", to: [], subject: "", text: "", timestamp: new Date() };
  },
}));

vi.mock("./agentmail", () => ({
  isAgentMailConfigured: () => mail.configured,
  createAgentMailInbox: vi.fn(async (input: Record<string, unknown>) => {
    if (mail.failCreate) throw new Error("provider down");
    mail.created.push(input);
    return { inboxId: "inbox-1", address: "mira-4f2a@agentmail.to", displayName: null };
  }),
  sendAgentMailMessage: vi.fn(async (input: Record<string, unknown>) => {
    mail.sent.push(input);
    return { messageId: "msg-1", threadId: "thr-1" };
  }),
  listAgentMailMessages: vi.fn(async () => mail.listResult),
  getAgentMailMessage: vi.fn(async () => mail.getResult),
  normalizeEmailAddress: (value: string) => {
    const angled = value.trim().match(/<([^>]+)>/);
    return (angled ? angled[1] : value.trim()).trim().toLowerCase();
  },
  AgentMailError: class AgentMailError extends Error {
    readonly status = 0;
  },
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => script.fakeDb),
  getOrCreateWorkspace: vi.fn(async () => ({ id: 5, ownerId: 1 })),
  getChatForUser: vi.fn(async () => undefined),
  getUserIdentityForUser: vi.fn(async () => ({
    username: null,
    name: "Test User",
    email: "owner@example.com",
  })),
}));

const {
  AgentNameTakenError,
  agentEmailAliasFor,
  backfillAgentMailInboxes,
  agentPhoneHandleFor,
  createAgentForUser,
  describeApprovalsForPrompt,
  decideApprovalForUser,
  requestAgentEmailApproval,
  requestWalletPurchaseApproval,
  slugifyAgentName,
  syncAgentMailInboxForUser,
  updateAgentForUser,
  walletRemainingCredits,
} = await import("./agents");

/**
 * Flattens a drizzle condition (or SQL wrapper) back into readable text, so a
 * test can assert on the clause Postgres would actually evaluate. Params are
 * skipped - the SQL keywords are what matters here.
 */
const sqlText = (node: unknown, depth = 0): string => {
  if (depth > 8 || node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(item => sqlText(item, depth + 1)).join("");
  const chunk = node as { queryChunks?: unknown; value?: unknown };
  const inner = chunk.queryChunks ?? chunk.value;
  return inner === undefined ? "" : sqlText(inner, depth + 1);
};

const agentRow = (overrides: Row = {}) => ({
  id: 11,
  workspaceId: 5,
  name: "Mira",
  role: "Researcher",
  instructions: null,
  emailAlias: "mira-4f2a@nova.local",
  phoneHandle: "+1-555-0142",
  walletBudgetCredits: 500,
  walletSpentCredits: 120,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const approvalRow = (overrides: Row = {}) => ({
  id: 12,
  workspaceId: 5,
  ownerId: 1,
  agentId: 11,
  chatId: "chat000000000000000001",
  action: "wallet_purchase",
  params: { item: "domain name", amountCredits: 40 },
  status: "pending",
  resultSummary: null,
  decidedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  script.state.reset();
  mail.reset();
});

describe("agent identity helpers", () => {
  it("slugifies names for the Nova-internal email alias", () => {
    expect(slugifyAgentName("Mira the Bold")).toBe("mira-the-bold");
    expect(slugifyAgentName("  Ünïcode!!  ")).toBe("n-code");
    expect(slugifyAgentName("!!!")).toBe("agent");
    expect(slugifyAgentName("a".repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it("mints aliases in the non-routable .local zone", () => {
    expect(agentEmailAliasFor("Mira", "4f2a")).toBe("mira-4f2a@nova.local");
  });

  it("issues phone handles only in the fictional +1-555-01XX range", () => {
    for (let i = 0; i < 25; i += 1) {
      expect(agentPhoneHandleFor()).toMatch(/^\+1-555-01\d{2}$/);
    }
  });

  it("computes wallet remaining credits and never goes negative", () => {
    expect(walletRemainingCredits({ walletBudgetCredits: 500, walletSpentCredits: 120 })).toBe(380);
    expect(walletRemainingCredits({ walletBudgetCredits: 100, walletSpentCredits: 400 })).toBe(0);
  });

  it("treats a null budget as an unlimited wallet", () => {
    expect(walletRemainingCredits({ walletBudgetCredits: null, walletSpentCredits: 120 })).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it("keeps the typed name-collision error recognisable", () => {
    expect(new AgentNameTakenError()).toBeInstanceOf(Error);
    expect(new AgentNameTakenError().name).toBe("AgentNameTakenError");
  });
});

describe("wallet purchase gating", () => {
  it("rejects an amount over the remaining budget without recording anything", async () => {
    script.state.selects = [[agentRow({ walletBudgetCredits: 500, walletSpentCredits: 480 })]];
    const outcome = await requestWalletPurchaseApproval(1, {
      agentId: 11,
      chatId: "chat000000000000000001",
      item: "domain name",
      amountCredits: 40,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Over budget");
    expect(script.state.insertCalls).toHaveLength(0);
  });

  it("rejects nonsense amounts and empty items", async () => {
    script.state.selects = [[agentRow()], [agentRow()]];
    const zero = await requestWalletPurchaseApproval(1, { agentId: 11, item: "x", amountCredits: 0 });
    expect(zero.ok).toBe(false);
    const noItem = await requestWalletPurchaseApproval(1, { agentId: 11, item: "   ", amountCredits: 10 });
    expect(noItem.ok).toBe(false);
    expect(script.state.insertCalls).toHaveLength(0);
  });

  it("records a pending approval and tells the agent nothing was paid", async () => {
    script.state.selects = [[agentRow()]];
    script.state.inserts = [[approvalRow()]];
    const outcome = await requestWalletPurchaseApproval(1, {
      agentId: 11,
      chatId: "chat000000000000000001",
      item: "domain name",
      amountCredits: 40,
      note: "for the launch site",
    });
    expect(outcome).toMatchObject({ ok: true, approvalId: 12 });
    if (outcome.ok) {
      expect(outcome.message).toContain("pending");
      expect(outcome.message).toContain("Agents page");
      expect(outcome.message).toContain("Nothing has been paid yet");
    }
    const call = script.state.insertCalls[0];
    expect(call.table).toBe(agentApprovals);
    expect(call.values).toMatchObject({
      status: "pending",
      action: "wallet_purchase",
      ownerId: 1,
      agentId: 11,
      params: { item: "domain name", amountCredits: 40, note: "for the launch site" },
    });
  });

  it("records a purchase no capped wallet could cover when the budget is unlimited", async () => {
    // 90,000 already spent: any capped wallet under the 100,000 max would
    // reject this. A null budget has no cap, so it must go through.
    script.state.selects = [[agentRow({ walletBudgetCredits: null, walletSpentCredits: 90000 })]];
    script.state.inserts = [[approvalRow()]];
    const outcome = await requestWalletPurchaseApproval(1, {
      agentId: 11,
      chatId: "chat000000000000000001",
      item: "compute cluster",
      amountCredits: 100000,
    });
    expect(outcome.ok).toBe(true);
    expect(script.state.insertCalls).toHaveLength(1);
  });

  it("fails closed when the agent no longer exists", async () => {
    script.state.selects = [[]];
    const outcome = await requestWalletPurchaseApproval(1, { agentId: 99, item: "x", amountCredits: 5 });
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.error).toContain("no longer exists");
  });
});

describe("agent budget storage", () => {
  it("stores a cleared budget as an unlimited wallet on create", async () => {
    script.state.inserts = [[agentRow({ walletBudgetCredits: null, walletSpentCredits: 0 })]];
    const created = await createAgentForUser(1, { name: "Nova", walletBudgetCredits: null });
    expect(created).toBeDefined();
    expect(script.state.insertCalls[0].values.walletBudgetCredits).toBeNull();
  });

  it("keeps the default budget when the field is never sent", async () => {
    script.state.inserts = [[agentRow()]];
    await createAgentForUser(1, { name: "Nova" });
    expect(script.state.insertCalls[0].values.walletBudgetCredits).toBe(500);
  });

  it("lifts the cap when the budget is cleared on update", async () => {
    script.state.selects = [[agentRow({ walletBudgetCredits: 500, walletSpentCredits: 120 })]];
    script.state.updates = [[agentRow({ walletBudgetCredits: null })]];
    const updated = await updateAgentForUser(1, 11, { walletBudgetCredits: null });
    expect(updated).toBeDefined();
    expect(script.state.updateCalls[0].values.walletBudgetCredits).toBeNull();
  });

  it("still floors a budget below what was already spent, inside the update", async () => {
    script.state.selects = [[agentRow({ walletBudgetCredits: 500, walletSpentCredits: 480 })]];
    script.state.updates = [[agentRow({ walletBudgetCredits: 480 })]];
    await updateAgentForUser(1, 11, { walletBudgetCredits: 10 });
    // The floor is computed in SQL against the row's *current* spending, so a
    // concurrent approval debiting the wallet can't leave the cap below what
    // was spent (a stale JS-side read could).
    const applied = sqlText(script.state.updateCalls[0].values.walletBudgetCredits);
    expect(applied).toContain("GREATEST");
    expect(applied).not.toContain("480");
  });
});

describe("agent email gating", () => {
  it("rejects an unknown alias but lists the known ones", async () => {
    script.state.selects = [[agentRow()], [agentRow()]];
    const outcome = await requestAgentEmailApproval(1, {
      agentId: 11,
      to: "nobody@nova.local",
      subject: "Hi",
      body: "Hello",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("nobody@nova.local");
      expect(outcome.error).toContain("mira-4f2a@nova.local");
    }
    expect(script.state.insertCalls).toHaveLength(0);
  });

  it("rejects an agent mailing itself", async () => {
    script.state.selects = [[agentRow()], [agentRow()]];
    const outcome = await requestAgentEmailApproval(1, {
      agentId: 11,
      to: "mira-4f2a@nova.local",
      subject: "Hi",
      body: "Hello",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("cannot mail itself");
  });

  it("creates a pending send_email approval addressed to a teammate", async () => {
    const peer = agentRow({ id: 12, name: "Pip", emailAlias: "pip-9c1d@nova.local" });
    script.state.selects = [[agentRow()], [agentRow(), peer]];
    script.state.inserts = [[approvalRow({ id: 15, action: "send_email" })]];
    const outcome = await requestAgentEmailApproval(1, {
      agentId: 11,
      chatId: "chat000000000000000001",
      to: "pip-9c1d@nova.local",
      subject: "Shortlist ready",
      body: "Venue shortlist attached.",
    });
    expect(outcome).toMatchObject({ ok: true, approvalId: 15 });
    if (outcome.ok) expect(outcome.message).toContain("Nothing has been sent yet");
    const call = script.state.insertCalls[0];
    expect(call.table).toBe(agentApprovals);
    expect(call.values).toMatchObject({
      action: "send_email",
      status: "pending",
      params: { to: "pip-9c1d@nova.local", toAgentId: 12, subject: "Shortlist ready" },
    });
  });

  it("addresses the workspace owner when the recipient is 'user'", async () => {
    script.state.selects = [[agentRow()], [agentRow()]];
    script.state.inserts = [[approvalRow({ id: 16, action: "send_email" })]];
    const outcome = await requestAgentEmailApproval(1, {
      agentId: 11,
      to: "user",
      subject: "Done",
      body: "All set.",
    });
    expect(outcome.ok).toBe(true);
    const call = script.state.insertCalls[0];
    expect((call.values.params as Row).toAgentId).toBeNull();
  });
});

describe("approval decisions", () => {
  it("approving a purchase debits the wallet and executes the approval", async () => {
    // Claim (pending -> executed), debit, finalize summary.
    script.state.updates = [
      [approvalRow({ status: "executed", resultSummary: "Approval claimed - completing the action." })],
      [{ id: 99 }],
      [approvalRow({ status: "executed", resultSummary: "Approved - paid 40 credits for \"domain name\". 340 credits remain in the wallet." })],
    ];
    script.state.selects = [[agentRow({ walletSpentCredits: 160 })]];
    const result = await decideApprovalForUser(1, 12, "approve");
    expect(result?.executed).toBe(true);
    expect(result?.approval.status).toBe("executed");
    expect(result?.approval.resultSummary).toContain("paid 40 credits");
    expect(script.state.updateCalls[0].table).toBe(agentApprovals);
    expect(script.state.updateCalls[0].values).toMatchObject({ status: "executed" });
    expect(script.state.updateCalls[1].table).toBe(agentProfiles);
    expect(script.state.updateCalls[2].table).toBe(agentApprovals);
    expect(script.state.updateCalls[2].values).toMatchObject({ status: "executed" });
  });

  it("marks a purchase failed when the budget can no longer cover it", async () => {
    script.state.updates = [
      [approvalRow({ status: "executed", resultSummary: "Approval claimed - completing the action." })],
      [], // guarded debit returned no row
      [approvalRow({ status: "failed", resultSummary: "Not completed: the wallet budget is exhausted (0 credits left)." })],
    ];
    // One lookup for the remaining-credits message, one inside finish().
    script.state.selects = [
      [agentRow({ walletBudgetCredits: 500, walletSpentCredits: 500 })],
      [agentRow({ walletBudgetCredits: 500, walletSpentCredits: 500 })],
    ];
    const result = await decideApprovalForUser(1, 12, "approve");
    expect(result?.executed).toBe(false);
    expect(result?.approval.status).toBe("failed");
    expect(result?.approval.resultSummary).toContain("budget is exhausted");
  });

  it("debits an unlimited wallet without the budget guard rejecting it", async () => {
    // Claim, debit, finalize - the same three updates as a capped approval.
    script.state.updates = [
      [approvalRow({ status: "executed", resultSummary: "Approval claimed - completing the action." })],
      [{ id: 99 }],
      [approvalRow({ status: "executed", resultSummary: "Approved - paid 40 credits." })],
    ];
    script.state.selects = [[agentRow({ walletBudgetCredits: null, walletSpentCredits: 160 })]];
    const result = await decideApprovalForUser(1, 12, "approve");
    expect(result?.executed).toBe(true);
    const debit = script.state.updateCalls.find(call => call.table === agentProfiles);
    expect(debit).toBeDefined();
    // `spent + amount <= NULL` matches no row in Postgres, so the guard has
    // to short-circuit on a null budget instead of comparing it.
    expect(sqlText(debit!.condition)).toContain("IS NULL");
  });

  it("denying never touches the wallet", async () => {
    script.state.updates = [[approvalRow({ status: "denied", resultSummary: "The user declined this request." })]];
    script.state.selects = [[agentRow()]];
    const result = await decideApprovalForUser(1, 12, "deny");
    expect(result).toMatchObject({ executed: false });
    expect(result?.approval.status).toBe("denied");
    expect(script.state.updateCalls).toHaveLength(1);
    expect(script.state.updateCalls[0].table).toBe(agentApprovals);
  });

  it("returns null for a missing or already-decided approval", async () => {
    // Claim UPDATE matches no pending row.
    script.state.updates = [[]];
    await expect(decideApprovalForUser(1, 12, "approve")).resolves.toBeNull();
  });

  it("approving an email delivers it to the internal mailbox", async () => {
    script.state.updates = [
      [approvalRow({
        action: "send_email",
        status: "executed",
        params: { to: "pip-9c1d@nova.local", toAgentId: 12, subject: "Hi", body: "Hello" },
        resultSummary: "Approval claimed - completing the action.",
      })],
      [approvalRow({
        action: "send_email",
        status: "executed",
        resultSummary: "Approved - email delivered to pip-9c1d@nova.local.",
      })],
    ];
    script.state.inserts = [[{ id: 7 }]];
    script.state.selects = [[agentRow()]];
    const result = await decideApprovalForUser(1, 12, "approve");
    expect(result?.executed).toBe(true);
    expect(script.state.updateCalls[0].table).toBe(agentApprovals);
    expect(script.state.insertCalls[0].table).toBe(agentEmails);
    expect(script.state.insertCalls[0].values).toMatchObject({
      fromAgentId: 11,
      toAgentId: 12,
      subject: "Hi",
      body: "Hello",
    });
  });
});

describe("approval prompt line", () => {
  it("summarises pending and recently decided requests for the agent", async () => {
    script.state.selects = [
      [approvalRow()],
      [approvalRow({
        id: 9,
        status: "denied",
        resultSummary: "The user declined this request.",
        params: { to: "user", subject: "Ping", body: "hi" },
        action: "send_email",
      })],
    ];
    const line = await describeApprovalsForPrompt(1, 11);
    expect(line).toContain("waiting for the user");
    expect(line).toContain("#12");
    expect(line).toContain("domain name");
    expect(line).toContain("recent decisions");
    expect(line).toContain("declined");
  });

  it("says so plainly when nothing is waiting", async () => {
    script.state.selects = [[], []];
    const line = await describeApprovalsForPrompt(1, 11);
    expect(line).toContain("no approvals are waiting");
  });
});

describe("AgentMail-backed agent email", () => {
  it("provisions a real inbox on agent creation when configured", async () => {
    mail.configured = true;
    script.state.inserts = [[agentRow({ agentmailInboxId: "inbox-1", agentmailAddress: "mira-4f2a@agentmail.to" })]];
    const created = await createAgentForUser(1, { name: "Mira" });
    expect(created).toBeDefined();
    expect(mail.created).toHaveLength(1);
    expect(mail.created[0]).toMatchObject({ displayName: "Mira" });
    // The idempotency key carries the workspace id, so it is globally unique.
    expect(mail.created[0].clientId).toContain("nova-5-");
    expect(script.state.insertCalls[0].values).toMatchObject({
      agentmailInboxId: "inbox-1",
      agentmailAddress: "mira-4f2a@agentmail.to",
    });
  });

  it("keeps the Nova-internal alias when AgentMail is not configured", async () => {
    mail.configured = false;
    script.state.inserts = [[agentRow()]];
    await createAgentForUser(1, { name: "Mira" });
    expect(mail.created).toHaveLength(0);
    expect(script.state.insertCalls[0].values).toMatchObject({
      agentmailInboxId: null,
      agentmailAddress: null,
    });
  });

  it("refuses an external recipient until AgentMail is configured", async () => {
    mail.configured = false;
    script.state.selects = [[agentRow()], [agentRow()]];
    const outcome = await requestAgentEmailApproval(1, {
      agentId: 11,
      to: "someone@example.com",
      subject: "Hi",
      body: "Hello",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("AgentMail is not configured");
  });

  it("accepts an external recipient when AgentMail is configured", async () => {
    mail.configured = true;
    script.state.selects = [[agentRow()], [agentRow()]];
    script.state.inserts = [[approvalRow({ id: 20, action: "send_email" })]];
    const outcome = await requestAgentEmailApproval(1, {
      agentId: 11,
      to: "Someone@Example.com",
      subject: "Hi",
      body: "Hello",
    });
    expect(outcome.ok).toBe(true);
    expect(script.state.insertCalls[0].values.params).toMatchObject({
      to: "someone@example.com",
      toAgentId: null,
      toAddress: "someone@example.com",
    });
  });

  it("delivers an approved email through the agent's AgentMail inbox", async () => {
    mail.configured = true;
    const params = {
      to: "someone@example.com",
      toAgentId: null,
      toAddress: "someone@example.com",
      subject: "Hi",
      body: "Hello",
    };
    script.state.updates = [
      [approvalRow({ id: 30, action: "send_email", status: "executed", params })],
      [approvalRow({ id: 30, action: "send_email", status: "executed", params })],
    ];
    script.state.selects = [
      [agentRow({ agentmailInboxId: "inbox-1", agentmailAddress: "mira-4f2a@agentmail.to" })],
      [agentRow()],
    ];
    script.state.inserts = [[{ id: 1 }]];
    const result = await decideApprovalForUser(1, 30, "approve");
    expect(result?.executed).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      inboxId: "inbox-1",
      to: "someone@example.com",
      subject: "Hi",
      text: "Hello",
    });
  });

  it("fails an approved external email when no sender inbox can be provisioned", async () => {
    mail.configured = true;
    mail.failCreate = true;
    const params = {
      to: "someone@example.com",
      toAgentId: null,
      toAddress: "someone@example.com",
      subject: "Hi",
      body: "Hello",
    };
    script.state.updates = [
      [approvalRow({ id: 31, action: "send_email", status: "executed", params })],
      [approvalRow({ id: 31, action: "send_email", status: "failed", params })],
    ];
    script.state.selects = [[agentRow()], [agentRow()]];
    const result = await decideApprovalForUser(1, 31, "approve");
    expect(result?.executed).toBe(false);
    expect(mail.sent).toHaveLength(0);
    expect(script.state.insertCalls.find(call => call.table === agentEmails)).toBeUndefined();
  });

  it("swaps fake aliases for real inboxes across all agents", async () => {
    mail.configured = true;
    script.state.selects = [
      [agentRow(), agentRow({ id: 12, name: "Pip", emailAlias: "pip-9c1d@nova.local" })],
    ];
    script.state.updates = [
      [agentRow({ agentmailInboxId: "inbox-1", agentmailAddress: "mira-4f2a@agentmail.to" })],
      [agentRow({ id: 12, agentmailInboxId: "inbox-1", agentmailAddress: "pip-9c1d@agentmail.to" })],
    ];
    const summary = await backfillAgentMailInboxes();
    expect(summary).toEqual({ examined: 2, provisioned: 2, failed: 0 });
    expect(mail.created).toHaveLength(2);
    expect(script.state.updateCalls).toHaveLength(2);
  });

  it("refuses to run the backfill without AgentMail configured", async () => {
    mail.configured = false;
    await expect(backfillAgentMailInboxes()).rejects.toThrow(/not configured/);
  });

  it("backfills a real inbox for an agent that predates AgentMail", async () => {
    mail.configured = true;
    script.state.selects = [[agentRow()]];
    script.state.updates = [
      [agentRow({ agentmailInboxId: "inbox-1", agentmailAddress: "mira-4f2a@agentmail.to" })],
    ];
    await syncAgentMailInboxForUser(1);
    expect(mail.created).toHaveLength(1);
    expect(script.state.updateCalls[0].values).toMatchObject({
      agentmailInboxId: "inbox-1",
      agentmailAddress: "mira-4f2a@agentmail.to",
    });
  });

  it("syncs inbound mail into the workspace mailbox, deduped by message id", async () => {
    mail.configured = true;
    mail.listResult = [
      {
        messageId: "m-in",
        from: "Owner <owner@example.com>",
        to: ["mira-4f2a@agentmail.to"],
        subject: "Re: hello",
        text: "the reply",
        timestamp: new Date(),
      },
    ];
    script.state.selects = [
      [agentRow({ agentmailInboxId: "inbox-1", agentmailAddress: "mira-4f2a@agentmail.to" })],
      [],
    ];
    script.state.inserts = [[{ id: 9 }]];
    await syncAgentMailInboxForUser(1);
    const insert = script.state.insertCalls.find(call => call.table === agentEmails);
    expect(insert?.values).toMatchObject({
      direction: "inbound",
      fromAgentId: null,
      toAgentId: 11,
      fromAddress: "owner@example.com",
      toAddress: "mira-4f2a@agentmail.to",
      messageId: "m-in",
      subject: "Re: hello",
      body: "the reply",
    });
  });
});
