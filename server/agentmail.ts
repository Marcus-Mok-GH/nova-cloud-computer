import { ENV } from "./_core/env";

/**
 * Thin AgentMail client for Nova's personal agents.
 *
 * AgentMail (https://agentmail.to) gives each agent a real, routable inbox:
 * mail is sent from the agent's own address and replies land back in that
 * inbox, which `agents.ts` syncs into the workspace mailbox. This module is
 * intentionally a small fetch wrapper, matching how the other provider
 * clients here (composio, netlify, ...) are written - no SDK dependency.
 *
 * Everything is optional: when `AGENTMAIL_API_KEY` is unset, `agents.ts`
 * falls back to the Nova-internal mailbox, so the app runs unchanged without
 * the provider.
 */

const AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";
/** Per-request timeout; a hung provider must never stall an agent run. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The configured AgentMail API key, or "" when the provider is not set up. */
export function agentMailApiKey(): string {
  return (ENV.agentmailApiKey || process.env.AGENTMAIL_API_KEY || "").trim();
}

/** True when AgentMail is configured and agent mail should be delivered for real. */
export function isAgentMailConfigured(): boolean {
  return agentMailApiKey().length > 0;
}

export class AgentMailError extends Error {
  /** HTTP status; 0 for configuration and network failures. */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentMailError";
    this.status = status;
  }
}

export type AgentMailInbox = {
  inboxId: string;
  /** The inbox's routable address, e.g. `mira-4f2a@agentmail.to`. */
  address: string;
  displayName: string | null;
};

export type AgentMailMessage = {
  messageId: string;
  threadId: string;
  /** Envelope sender, e.g. `Mira <mira@agentmail.to>` or an external address. */
  from: string;
  to: string[];
  subject: string;
  /** Plain-text body, preferring the reply-extracted content when present. */
  text: string;
  timestamp: Date;
};

type RawMessage = {
  message_id?: unknown;
  thread_id?: unknown;
  from?: unknown;
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  extracted_text?: unknown;
  preview?: unknown;
  timestamp?: unknown;
};

async function callAgentMail<T>(path: string, init: RequestInit): Promise<T> {
  const key = agentMailApiKey();
  if (!key) {
    throw new AgentMailError(0, "AgentMail is not configured (AGENTMAIL_API_KEY is unset).");
  }
  let response: Response;
  try {
    response = await fetch(`${AGENTMAIL_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AgentMailError(
      0,
      `AgentMail could not be reached: ${error instanceof Error ? error.message : "network error"}`
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AgentMailError(
      response.status,
      `AgentMail rejected the request (HTTP ${response.status}): ${body.slice(0, 300) || "no response body"}`
    );
  }
  return (await response.json()) as T;
}

function toAgentMailMessage(raw: RawMessage): AgentMailMessage {
  const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const body =
    asString(raw.extracted_text) || asString(raw.text) || asString(raw.preview) || "";
  return {
    messageId: asString(raw.message_id),
    threadId: asString(raw.thread_id),
    from: asString(raw.from),
    to: Array.isArray(raw.to) ? raw.to.filter((item): item is string => typeof item === "string") : [],
    subject: asString(raw.subject) || "(no subject)",
    text: body,
    timestamp: new Date(asString(raw.timestamp) || Date.now()),
  };
}

/**
 * Creates a fresh inbox. `username` is the local part (a random one is
 * generated when omitted); `clientId` makes a retry idempotent so a lost
 * response never leaves two inboxes for one agent.
 */
export async function createAgentMailInbox(input: {
  username?: string;
  displayName?: string;
  clientId?: string;
}): Promise<AgentMailInbox> {
  const body: Record<string, string> = {};
  if (input.username) body.username = input.username;
  if (input.displayName) body.display_name = input.displayName;
  if (input.clientId) body.client_id = input.clientId;
  const created = await callAgentMail<{ inbox_id?: unknown; email?: unknown; display_name?: unknown }>(
    "/inboxes",
    { method: "POST", body: JSON.stringify(body) }
  );
  const inboxId = typeof created.inbox_id === "string" ? created.inbox_id : "";
  const address = typeof created.email === "string" ? created.email : "";
  if (!inboxId || !address) {
    throw new AgentMailError(0, "AgentMail created an inbox without an id or address.");
  }
  return {
    inboxId,
    address,
    displayName: typeof created.display_name === "string" ? created.display_name : null,
  };
}

/** Sends one plain-text message from an agent's inbox. */
export async function sendAgentMailMessage(input: {
  inboxId: string;
  to: string;
  subject: string;
  text: string;
}): Promise<{ messageId: string; threadId: string }> {
  const sent = await callAgentMail<{ message_id?: unknown; thread_id?: unknown }>(
    `/inboxes/${encodeURIComponent(input.inboxId)}/messages/send`,
    {
      method: "POST",
      body: JSON.stringify({
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    }
  );
  return {
    messageId: typeof sent.message_id === "string" ? sent.message_id : "",
    threadId: typeof sent.thread_id === "string" ? sent.thread_id : "",
  };
}

/**
 * Lists the most recent messages in an inbox, newest first. The list response
 * carries only a preview, so callers that need the body fetch each message
 * with `getAgentMailMessage` - only for ids they have not stored yet.
 */
export async function listAgentMailMessages(input: {
  inboxId: string;
  limit?: number;
}): Promise<AgentMailMessage[]> {
  const query = new URLSearchParams({
    limit: String(Math.max(1, Math.min(100, input.limit ?? 20))),
    ascending: "false",
  });
  const listed = await callAgentMail<{ messages?: unknown }>(
    `/inboxes/${encodeURIComponent(input.inboxId)}/messages?${query.toString()}`,
    { method: "GET" }
  );
  const messages = Array.isArray(listed.messages) ? listed.messages : [];
  return messages
    .filter((message): message is RawMessage => Boolean(message) && typeof message === "object")
    .map(toAgentMailMessage)
    .filter(message => message.messageId !== "");
}

/** Fetches one message, including its full text body. */
export async function getAgentMailMessage(input: {
  inboxId: string;
  messageId: string;
}): Promise<AgentMailMessage> {
  const raw = await callAgentMail<RawMessage>(
    `/inboxes/${encodeURIComponent(input.inboxId)}/messages/${encodeURIComponent(input.messageId)}`,
    { method: "GET" }
  );
  return toAgentMailMessage(raw);
}

/**
 * Normalizes an address header (`Display Name <user@host>` or `user@host`)
 * down to the bare `user@host`, so stored envelope addresses are comparable.
 */
export function normalizeEmailAddress(value: string): string {
  const trimmed = value.trim();
  const angled = trimmed.match(/<([^>]+)>/);
  return (angled ? angled[1] : trimmed).trim().toLowerCase();
}
