import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentMailError,
  agentMailApiKey,
  createAgentMailInbox,
  createAgentMailWebhook,
  getAgentMailMessage,
  isAgentMailConfigured,
  listAgentMailMessages,
  normalizeEmailAddress,
  parseAgentMailInboundEvent,
  replyToAgentMailMessage,
  sendAgentMailMessage,
  verifyAgentMailWebhookSignature,
} from "./agentmail";

/** A fetch stub that records calls and returns scripted JSON responses. */
function stubFetch(
  handler: (url: string, init: RequestInit) => { ok?: boolean; status?: number; body?: unknown; text?: string }
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    const requestInit = init ?? {};
    calls.push({ url: target, init: requestInit });
    const result = handler(target, requestInit);
    if (result.ok === false) {
      return {
        ok: false,
        status: result.status ?? 400,
        text: async () => result.text ?? "",
        json: async () => result.body ?? {},
      };
    }
    return {
      ok: true,
      status: result.status ?? 200,
      text: async () => result.text ?? "",
      json: async () => result.body ?? {},
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const originalKey = process.env.AGENTMAIL_API_KEY;

beforeEach(() => {
  process.env.AGENTMAIL_API_KEY = "am_test_key";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.AGENTMAIL_API_KEY;
  else process.env.AGENTMAIL_API_KEY = originalKey;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AgentMail configuration", () => {
  it("reports configured only when a key is present", () => {
    process.env.AGENTMAIL_API_KEY = "am_test_key";
    expect(isAgentMailConfigured()).toBe(true);
    expect(agentMailApiKey()).toBe("am_test_key");

    process.env.AGENTMAIL_API_KEY = "   ";
    expect(isAgentMailConfigured()).toBe(false);
  });

  it("refuses provider calls when unconfigured", async () => {
    process.env.AGENTMAIL_API_KEY = "";
    await expect(createAgentMailInbox({})).rejects.toBeInstanceOf(AgentMailError);
  });
});

describe("inbox provisioning", () => {
  it("creates an inbox with idempotency and maps the address", async () => {
    const calls = stubFetch(() => ({
      body: { inbox_id: "inbox-1", email: "mira-4f2a@agentmail.to", display_name: "Mira" },
    }));
    const inbox = await createAgentMailInbox({
      username: "mira-4f2a",
      displayName: "Mira",
      clientId: "nova-mira-4f2a",
    });
    expect(inbox).toEqual({
      inboxId: "inbox-1",
      address: "mira-4f2a@agentmail.to",
      displayName: "Mira",
    });
    const { url, init } = calls[0];
    expect(url).toBe("https://api.agentmail.to/v0/inboxes");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer am_test_key");
    expect(JSON.parse(String(init.body))).toEqual({
      username: "mira-4f2a",
      display_name: "Mira",
      client_id: "nova-mira-4f2a",
    });
  });

  it("rejects a response without an id or address", async () => {
    stubFetch(() => ({ body: { inbox_id: "", email: "" } }));
    await expect(createAgentMailInbox({})).rejects.toBeInstanceOf(AgentMailError);
  });
});

describe("sending mail", () => {
  it("posts to the inbox's send endpoint", async () => {
    const calls = stubFetch(() => ({ body: { message_id: "msg-1", thread_id: "thr-1" } }));
    const sent = await sendAgentMailMessage({
      inboxId: "inbox 1",
      to: "owner@example.com",
      subject: "Hi",
      text: "Body",
    });
    expect(sent).toEqual({ messageId: "msg-1", threadId: "thr-1" });
    expect(calls[0].url).toContain("/inboxes/inbox%201/messages/send");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      to: ["owner@example.com"],
      subject: "Hi",
      text: "Body",
    });
  });

  it("surfaces provider errors with their status", async () => {
    stubFetch(() => ({ ok: false, status: 403, text: "blocked" }));
    await expect(
      sendAgentMailMessage({ inboxId: "i", to: "a@b.com", subject: "s", text: "t" })
    ).rejects.toMatchObject({ name: "AgentMailError", status: 403 });
  });
});

describe("reading mail", () => {
  it("maps listed messages, preferring extracted text", async () => {
    const calls = stubFetch(() => ({
      body: {
        messages: [
          {
            message_id: "m1",
            thread_id: "t1",
            from: "Owner <owner@example.com>",
            to: ["mira-4f2a@agentmail.to"],
            subject: "Re: hello",
            preview: "preview only",
            extracted_text: "the reply body",
            timestamp: "2026-10-02T10:00:00Z",
          },
          { message_id: "", subject: "malformed" },
        ],
      },
    }));
    const messages = await listAgentMailMessages({ inboxId: "inbox-1", limit: 10 });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: "m1",
      from: "Owner <owner@example.com>",
      to: ["mira-4f2a@agentmail.to"],
      subject: "Re: hello",
      text: "the reply body",
    });
    expect(calls[0].url).toContain("/inboxes/inbox-1/messages?");
  });

  it("follows pagination so mail beyond the first page is not dropped", async () => {
    let call = 0;
    stubFetch(() => {
      call += 1;
      return call === 1
        ? { body: { messages: [{ message_id: "m1", subject: "one" }], next_page_token: "tok" } }
        : { body: { messages: [{ message_id: "m2", subject: "two" }] } };
    });
    const messages = await listAgentMailMessages({ inboxId: "inbox-1", limit: 1 });
    expect(messages.map(message => message.messageId)).toEqual(["m1", "m2"]);
  });

  it("fetches one message with its full body", async () => {
    stubFetch(() => ({ body: { message_id: "m2", text: "full body", subject: "s" } }));
    const message = await getAgentMailMessage({ inboxId: "inbox-1", messageId: "m2" });
    expect(message.text).toBe("full body");
  });
});

describe("address normalization", () => {
  it("strips display names and lower-cases", () => {
    expect(normalizeEmailAddress("Mira <Mira-4F2A@AgentMail.To>")).toBe("mira-4f2a@agentmail.to");
    expect(normalizeEmailAddress("  a@b.com ")).toBe("a@b.com");
  });
});

describe("replying to mail", () => {
  it("posts to the message's reply endpoint in the same thread", async () => {
    const calls = stubFetch(() => ({ body: { message_id: "msg-2", thread_id: "thr-1" } }));
    const sent = await replyToAgentMailMessage({
      inboxId: "inbox 1",
      messageId: "msg 1",
      to: "owner@example.com",
      text: "Thanks for the note.",
    });
    expect(sent).toEqual({ messageId: "msg-2", threadId: "thr-1" });
    expect(calls[0].url).toContain("/inboxes/inbox%201/messages/msg%201/reply");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      to: ["owner@example.com"],
      text: "Thanks for the note.",
    });
  });

  it("omits the recipient when none is given so the provider derives it", async () => {
    const calls = stubFetch(() => ({ body: { message_id: "m", thread_id: "t" } }));
    await replyToAgentMailMessage({ inboxId: "i", messageId: "m", text: "hi" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "hi" });
  });
});

describe("webhook registration", () => {
  it("registers a message.received webhook and returns its one-time secret", async () => {
    const calls = stubFetch(() => ({ body: { webhook_id: "wh-1", secret: "whsec_abc" } }));
    const webhook = await createAgentMailWebhook({
      url: "https://nova.example/api/agentmail/webhook",
      clientId: "nova-agent-email-replies",
    });
    expect(webhook).toEqual({ webhookId: "wh-1", secret: "whsec_abc" });
    expect(calls[0].url).toBe("https://api.agentmail.to/v0/webhooks");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      url: "https://nova.example/api/agentmail/webhook",
      event_types: ["message.received"],
      client_id: "nova-agent-email-replies",
    });
  });

  it("rejects a webhook response without a secret", async () => {
    stubFetch(() => ({ body: { webhook_id: "wh-1", secret: "" } }));
    await expect(
      createAgentMailWebhook({ url: "https://nova.example/webhook" })
    ).rejects.toBeInstanceOf(AgentMailError);
  });
});

describe("webhook signature verification", () => {
  const key = Buffer.from("super-secret-signing-key");
  const secret = `whsec_${key.toString("base64")}`;
  const sign = (id: string, timestamp: string, body: string) =>
    `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;

  it("accepts a signature that matches the raw body and a fresh timestamp", () => {
    const now = 1_800_000_000_000;
    const timestamp = String(Math.floor(now / 1000));
    const body = JSON.stringify({ event_type: "message.received" });
    expect(
      verifyAgentMailWebhookSignature({
        rawBody: body,
        headers: {
          "svix-id": "msg_1",
          "svix-timestamp": timestamp,
          "svix-signature": sign("msg_1", timestamp, body),
        },
        secret,
        now,
      })
    ).toBe(true);
  });

  it("accepts any matching entry in a space-delimited signature header", () => {
    const now = 1_800_000_000_000;
    const timestamp = String(Math.floor(now / 1000));
    const body = "{}";
    expect(
      verifyAgentMailWebhookSignature({
        rawBody: body,
        headers: {
          "svix-id": "msg_1",
          "svix-timestamp": timestamp,
          "svix-signature": `v1,AAAA ${sign("msg_1", timestamp, body)}`,
        },
        secret,
        now,
      })
    ).toBe(true);
  });

  it("rejects a tampered body, a stale timestamp, and missing headers", () => {
    const now = 1_800_000_000_000;
    const timestamp = String(Math.floor(now / 1000));
    const body = "{\"a\":1}";
    expect(
      verifyAgentMailWebhookSignature({
        rawBody: "{\"a\":2}",
        headers: {
          "svix-id": "msg_1",
          "svix-timestamp": timestamp,
          "svix-signature": sign("msg_1", timestamp, body),
        },
        secret,
        now,
      })
    ).toBe(false);
    expect(
      verifyAgentMailWebhookSignature({
        rawBody: body,
        headers: {
          "svix-id": "msg_1",
          "svix-timestamp": String(Math.floor(now / 1000) - 3600),
          "svix-signature": sign("msg_1", timestamp, body),
        },
        secret,
        now,
      })
    ).toBe(false);
    expect(
      verifyAgentMailWebhookSignature({ rawBody: body, headers: {}, secret, now })
    ).toBe(false);
  });
});

describe("inbound event parsing", () => {
  it("flattens a message.received payload into replyable fields", () => {
    const event = parseAgentMailInboundEvent({
      type: "event",
      event_type: "message.received",
      event_id: "evt_1",
      message: {
        inbox_id: "inbox-1",
        message_id: "msg-1",
        thread_id: "thr-1",
        from_: ["Owner <Owner@Example.com>"],
        to: ["mira-4f2a@agentmail.to"],
        subject: "Re: hello",
        text: "the body",
        timestamp: "2026-10-03T10:00:00Z",
      },
    });
    expect(event).toMatchObject({
      eventId: "evt_1",
      inboxId: "inbox-1",
      messageId: "msg-1",
      threadId: "thr-1",
      from: "owner@example.com",
      to: ["mira-4f2a@agentmail.to"],
      subject: "Re: hello",
      text: "the body",
    });
  });

  it("ignores other event types and payloads missing the ids", () => {
    expect(parseAgentMailInboundEvent({ event_type: "message.sent" })).toBeNull();
    expect(parseAgentMailInboundEvent({ event_type: "message.received", message: {} })).toBeNull();
    expect(parseAgentMailInboundEvent(null)).toBeNull();
  });

  it("flags machine-generated mail from its headers", () => {
    const withHeaders = (headers: Record<string, string>) =>
      parseAgentMailInboundEvent({
        event_type: "message.received",
        message: { inbox_id: "i", message_id: "m", headers },
      })?.automated;
    expect(withHeaders({ "Auto-Submitted": "auto-replied" })).toBe(true);
    expect(withHeaders({ "Auto-Submitted": "auto-generated" })).toBe(true);
    expect(withHeaders({ Precedence: "bulk" })).toBe(true);
    expect(withHeaders({ "X-Autoreply": "yes" })).toBe(true);
    expect(withHeaders({ "X-Auto-Response-Suppress": "All" })).toBe(true);
    // A normal reply is not automated, and "Auto-Submitted: no" is explicit.
    expect(withHeaders({ "Auto-Submitted": "no", Subject: "Hi" })).toBe(false);
    expect(
      parseAgentMailInboundEvent({
        event_type: "message.received",
        message: { inbox_id: "i", message_id: "m" },
      })?.automated
    ).toBe(false);
  });
});
