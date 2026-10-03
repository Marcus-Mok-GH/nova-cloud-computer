import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentMailError,
  agentMailApiKey,
  createAgentMailInbox,
  getAgentMailMessage,
  isAgentMailConfigured,
  listAgentMailMessages,
  normalizeEmailAddress,
  sendAgentMailMessage,
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
