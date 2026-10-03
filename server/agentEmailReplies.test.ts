import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Inbound auto-reply tests. The provider client, the claim helper and the
 * agent runtime are all mocked so the orchestration's decisions - claim,
 * run, deliver, record - are asserted without network or database access.
 */
const state = vi.hoisted(() => ({
  configured: true,
  replyCalls: [] as Array<Record<string, unknown>>,
  replyShouldFail: false,
  claim: undefined as unknown,
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  runReply: "Thanks for the note.",
  runShouldThrow: false,
  runCalls: [] as unknown[][],
  claimCalls: [] as unknown[],
  reset() {
    this.configured = true;
    this.replyCalls = [];
    this.replyShouldFail = false;
    this.claim = undefined;
    this.inserted = [];
    this.updated = [];
    this.runReply = "Thanks for the note.";
    this.runShouldThrow = false;
    this.runCalls = [];
    this.claimCalls = [];
  },
}));

vi.mock("./agentmail", async () => {
  const actual = await vi.importActual<typeof import("./agentmail")>("./agentmail");
  return {
    ...actual,
    isAgentMailConfigured: () => state.configured,
    replyToAgentMailMessage: vi.fn(async (input: Record<string, unknown>) => {
      state.replyCalls.push(input);
      if (state.replyShouldFail) throw new Error("provider down");
      return { messageId: "reply-1", threadId: "thr-1" };
    }),
  };
});

vi.mock("./agents", () => ({
  claimInboundAgentEmailForAutoReply: vi.fn(async (event: unknown) => {
    state.claimCalls.push(event);
    return state.claim;
  }),
  toProfileContext: vi.fn((row: Record<string, unknown>) => ({
    id: row.id,
    name: row.name,
  })),
  agentAddressFor: vi.fn(
    (row: Record<string, unknown>) => row.agentmailAddress ?? row.emailAlias
  ),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.inserted.push(values);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updated.push(values);
          return undefined;
        },
      }),
    }),
  })),
}));

vi.mock("./workspaceAgent", () => ({
  MAX_RUN_BUDGET_MS: 285_000,
  runWorkspaceAgent: vi.fn(async (...args: unknown[]) => {
    state.runCalls.push(args);
    if (state.runShouldThrow) throw new Error("gateway down");
    return {
      message: { content: state.runReply },
      actions: [],
      outOfBudget: false,
    };
  }),
}));

const { handleAgentMailInboundEvent, inboundEmailRunPrompt } = await import(
  "./agentEmailReplies"
);

const agent = {
  id: 11,
  workspaceId: 5,
  name: "Mira",
  emailAlias: "mira-4f2a@nova.local",
  agentmailInboxId: "inbox-1",
  agentmailAddress: "mira-4f2a@agentmail.to",
};

const event = {
  eventId: "evt-1",
  inboxId: "inbox-1",
  messageId: "msg-1",
  threadId: "thr-1",
  from: "owner@example.com",
  to: ["mira-4f2a@agentmail.to"],
  subject: "Quick question",
  text: "Can you summarize the report?",
  timestamp: new Date("2026-10-03T10:00:00Z"),
  automated: false,
};

const payload = {
  type: "event",
  event_type: "message.received",
  event_id: "evt-1",
  message: {
    inbox_id: "inbox-1",
    message_id: "msg-1",
    thread_id: "thr-1",
    from_: ["Owner <owner@example.com>"],
    to: ["mira-4f2a@agentmail.to"],
    subject: "Quick question",
    text: "Can you summarize the report?",
    timestamp: "2026-10-03T10:00:00Z",
  },
};

beforeEach(() => {
  state.reset();
  vi.clearAllMocks();
});

describe("agent email auto-reply", () => {
  it("runs the agent and replies in the thread when the email is claimed", async () => {
    state.claim = { claimed: true, agent, ownerId: 1, event, chatId: "chat-1" };
    const outcome = await handleAgentMailInboundEvent(payload);
    expect(outcome).toEqual({
      status: "replied",
      agentId: 11,
      messageId: "reply-1",
    });
    expect(state.replyCalls[0]).toEqual({
      inboxId: "inbox-1",
      messageId: "msg-1",
      to: "owner@example.com",
      text: "Thanks for the note.",
    });
    expect(state.inserted[0]).toMatchObject({
      direction: "outbound",
      fromAgentId: 11,
      toAgentId: null,
      fromAddress: "mira-4f2a@agentmail.to",
      toAddress: "owner@example.com",
      messageId: "reply-1",
      subject: "Re: Quick question",
      body: "Thanks for the note.",
    });
    // The inbound row is marked answered only after delivery succeeds.
    expect(state.updated[0]).toMatchObject({ autoReplySentAt: expect.any(Date) });
  });

  it("keeps the run on the agent's personal chat with email tools withheld", async () => {
    state.claim = { claimed: true, agent, ownerId: 1, event, chatId: "chat-1" };
    await handleAgentMailInboundEvent(payload);
    const [ownerId, chatId, content, options] = state.runCalls[0] as [
      number,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(ownerId).toBe(1);
    expect(chatId).toBe("chat-1");
    expect(content).toContain("Can you summarize the report?");
    expect(options).toMatchObject({
      channel: "web",
      emailReply: true,
      agentChat: { profile: { id: 11 } },
    });
  });

  it("does nothing when the claim is lost to a retry", async () => {
    state.claim = { claimed: false, reason: "already-replied" };
    const outcome = await handleAgentMailInboundEvent(payload);
    expect(outcome).toEqual({ status: "ignored", reason: "already-replied" });
    expect(state.runCalls).toHaveLength(0);
    expect(state.replyCalls).toHaveLength(0);
  });

  it("ignores events that are not inbound mail and never claims them", async () => {
    const outcome = await handleAgentMailInboundEvent({ event_type: "message.sent" });
    expect(outcome).toEqual({ status: "ignored", reason: "not-an-inbound-event" });
    expect(state.claimCalls).toHaveLength(0);
  });

  it("ignores everything while AgentMail is not configured", async () => {
    state.configured = false;
    state.claim = { claimed: true, agent, ownerId: 1, event, chatId: "chat-1" };
    const outcome = await handleAgentMailInboundEvent(payload);
    expect(outcome).toEqual({ status: "ignored", reason: "agentmail-not-configured" });
    expect(state.claimCalls).toHaveLength(0);
  });

  it("does not send anything when the run fails or the reply is empty", async () => {
    state.claim = { claimed: true, agent, ownerId: 1, event, chatId: "chat-1" };
    state.runShouldThrow = true;
    expect(await handleAgentMailInboundEvent(payload)).toEqual({
      status: "failed",
      reason: "run-failed",
    });
    expect(state.replyCalls).toHaveLength(0);

    state.runShouldThrow = false;
    state.runReply = "   ";
    expect(await handleAgentMailInboundEvent(payload)).toEqual({
      status: "failed",
      reason: "empty-reply",
    });
    expect(state.replyCalls).toHaveLength(0);
  });

  it("reports a delivery failure without recording an outbound email", async () => {
    state.claim = { claimed: true, agent, ownerId: 1, event, chatId: "chat-1" };
    state.replyShouldFail = true;
    expect(await handleAgentMailInboundEvent(payload)).toEqual({
      status: "failed",
      reason: "delivery-failed",
    });
    expect(state.inserted).toHaveLength(0);
  });
});

describe("inbound email run prompt", () => {
  it("frames the mail as untrusted and the end_turn reply as the answer", () => {
    const prompt = inboundEmailRunPrompt({
      agentAddress: "mira-4f2a@agentmail.to",
      from: "owner@example.com",
      subject: "Quick question",
      text: "Can you summarize the report?",
    });
    expect(prompt).toContain("mira-4f2a@agentmail.to");
    expect(prompt).toContain("owner@example.com");
    expect(prompt).toContain("untrusted input");
    expect(prompt).toContain("Do not call send_agent_email");
  });
});
