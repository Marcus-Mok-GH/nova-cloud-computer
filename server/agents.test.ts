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
    updateCalls: [] as Array<{ table: unknown; values: Row }>,
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
          then: (onF: any, onR: any) => Promise.resolve(rows).then(onF, onR),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: () => {
          state.updateCalls.push({ table, values });
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

vi.mock("./db", () => ({
  getDb: vi.fn(async () => script.fakeDb),
  getOrCreateWorkspace: vi.fn(async () => ({ id: 5, ownerId: 1 })),
  getChatForUser: vi.fn(async () => undefined),
}));

const {
  AgentNameTakenError,
  agentEmailAliasFor,
  agentPhoneHandleFor,
  describeApprovalsForPrompt,
  decideApprovalForUser,
  requestAgentEmailApproval,
  requestWalletPurchaseApproval,
  slugifyAgentName,
  walletRemainingCredits,
} = await import("./agents");

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

beforeEach(() => script.state.reset());

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

  it("fails closed when the agent no longer exists", async () => {
    script.state.selects = [[]];
    const outcome = await requestWalletPurchaseApproval(1, { agentId: 99, item: "x", amountCredits: 5 });
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.error).toContain("no longer exists");
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
    script.state.selects = [[approvalRow()], [agentRow({ walletSpentCredits: 120 })]];
    script.state.updates = [[{ id: 99 }], [approvalRow({ status: "executed", resultSummary: "Approved - paid 40 credits for \"domain name\". 340 credits remain in the wallet." })]];
    const result = await decideApprovalForUser(1, 12, "approve");
    expect(result?.executed).toBe(true);
    expect(result?.approval.status).toBe("executed");
    expect(result?.approval.resultSummary).toContain("paid 40 credits");
    // First update is the guarded debit on the agent row, not the approval.
    expect(script.state.updateCalls[0].table).toBe(agentProfiles);
    expect(script.state.updateCalls[1].table).toBe(agentApprovals);
    expect(script.state.updateCalls[1].values).toMatchObject({ status: "executed" });
  });

  it("marks a purchase failed when the budget can no longer cover it", async () => {
    script.state.selects = [[approvalRow()], [agentRow({ walletBudgetCredits: 500, walletSpentCredits: 500 })]];
    // The guarded debit returned no row: the WHERE budget check rejected it.
    script.state.updates = [[], [approvalRow({ status: "failed", resultSummary: "Not completed: the wallet budget is exhausted (0 credits left)." })]];
    const result = await decideApprovalForUser(1, 12, "approve");
    expect(result?.executed).toBe(false);
    expect(result?.approval.status).toBe("failed");
    expect(result?.approval.resultSummary).toContain("budget is exhausted");
  });

  it("denying never touches the wallet", async () => {
    script.state.selects = [[approvalRow()], [agentRow()]];
    script.state.updates = [[approvalRow({ status: "denied", resultSummary: "The user declined this request." })]];
    const result = await decideApprovalForUser(1, 12, "deny");
    expect(result).toMatchObject({ executed: false });
    expect(result?.approval.status).toBe("denied");
    expect(script.state.updateCalls).toHaveLength(1);
    expect(script.state.updateCalls[0].table).toBe(agentApprovals);
  });

  it("returns null for a missing or already-decided approval", async () => {
    script.state.selects = [[]];
    await expect(decideApprovalForUser(1, 12, "approve")).resolves.toBeNull();
  });

  it("approving an email delivers it to the internal mailbox", async () => {
    script.state.selects = [[approvalRow({
      action: "send_email",
      params: { to: "pip-9c1d@nova.local", toAgentId: 12, subject: "Hi", body: "Hello" },
    })], [agentRow()]];
    script.state.inserts = [[{ id: 7 }]];
    script.state.updates = [[approvalRow({ status: "executed", resultSummary: "Approved - email delivered to pip-9c1d@nova.local." })]];
    const result = await decideApprovalForUser(1, 12, "approve");
    expect(result?.executed).toBe(true);
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
