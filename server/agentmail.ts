import { createHmac, timingSafeEqual } from "node:crypto";
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
/** Cap on pages followed per list call, so a large inbox cannot stall a sync. */
const MAX_LIST_PAGES = 5;

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
 * Lists messages in an inbox, newest first, following pagination up to
 * `MAX_LIST_PAGES` pages so a burst of mail larger than one page is not
 * silently dropped. The list response carries only a preview, so callers that
 * need the body fetch each message with `getAgentMailMessage`.
 */
export async function listAgentMailMessages(input: {
  inboxId: string;
  limit?: number;
}): Promise<AgentMailMessage[]> {
  const perPage = Math.max(1, Math.min(100, input.limit ?? 20));
  const collected: AgentMailMessage[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(perPage), ascending: "false" });
    if (pageToken) query.set("page_token", pageToken);
    const listed = await callAgentMail<{ messages?: unknown; next_page_token?: unknown }>(
      `/inboxes/${encodeURIComponent(input.inboxId)}/messages?${query.toString()}`,
      { method: "GET" }
    );
    const messages = Array.isArray(listed.messages) ? listed.messages : [];
    collected.push(
      ...messages
        .filter((message): message is RawMessage => Boolean(message) && typeof message === "object")
        .map(toAgentMailMessage)
        .filter(message => message.messageId !== "")
    );
    pageToken =
      typeof listed.next_page_token === "string" && listed.next_page_token
        ? listed.next_page_token
        : undefined;
    if (!pageToken) break;
  }
  return collected;
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

/**
 * Replies to a received message, staying in its thread. Passing the original
 * message id (rather than sending a fresh message) is what keeps the reply's
 * subject, threading and recipients correct on the provider side.
 */
export async function replyToAgentMailMessage(input: {
  inboxId: string;
  messageId: string;
  /** Recipient; omit to let AgentMail derive it from the original message. */
  to?: string;
  text: string;
}): Promise<{ messageId: string; threadId: string }> {
  const body: Record<string, unknown> = { text: input.text };
  if (input.to) body.to = [input.to];
  const sent = await callAgentMail<{ message_id?: unknown; thread_id?: unknown }>(
    `/inboxes/${encodeURIComponent(input.inboxId)}/messages/${encodeURIComponent(
      input.messageId
    )}/reply`,
    { method: "POST", body: JSON.stringify(body) }
  );
  return {
    messageId: typeof sent.message_id === "string" ? sent.message_id : "",
    threadId: typeof sent.thread_id === "string" ? sent.thread_id : "",
  };
}

/**
 * Registers (or re-registers) an AgentMail webhook. `secret` is returned only
 * by the create call, so the caller must persist it as
 * AGENTMAIL_WEBHOOK_SECRET - the signature on every delivery is verified with
 * it.
 */
export async function createAgentMailWebhook(input: {
  url: string;
  eventTypes?: string[];
  clientId?: string;
}): Promise<{ webhookId: string; secret: string }> {
  const body: Record<string, unknown> = {
    url: input.url,
    event_types: input.eventTypes ?? ["message.received"],
  };
  if (input.clientId) body.client_id = input.clientId;
  const created = await callAgentMail<{ webhook_id?: unknown; secret?: unknown }>(
    "/webhooks",
    { method: "POST", body: JSON.stringify(body) }
  );
  const webhookId = typeof created.webhook_id === "string" ? created.webhook_id : "";
  const secret = typeof created.secret === "string" ? created.secret : "";
  if (!webhookId || !secret) {
    throw new AgentMailError(0, "AgentMail created a webhook without an id or secret.");
  }
  return { webhookId, secret };
}

/**
 * The inbound-message fields `message.received` handlers need, flattened off
 * the webhook payload. Returns null when the payload is not a received-message
 * event or is missing the ids needed to reply.
 */
export type AgentMailInboundEvent = {
  eventId: string;
  inboxId: string;
  messageId: string;
  threadId: string;
  /** Bare sender address, e.g. `owner@example.com`. */
  from: string;
  to: string[];
  subject: string;
  text: string;
  timestamp: Date;
  /**
   * True when the message headers identify it as machine-generated (an
   * out-of-office, list, or auto-responder). Auto-replying to one of those
   * starts a reply loop, so callers skip them.
   */
  automated: boolean;
};

/**
 * Reads the common auto-responder markers off the message headers. Tolerant on
 * purpose: the payload may omit headers entirely, so an unknown shape simply
 * reports "not automated" rather than throwing.
 */
function hasAutomatedMailHeaders(message: Record<string, unknown>): boolean {
  const raw = message.headers;
  if (!raw || typeof raw !== "object") return false;
  const headers = raw as Record<string, unknown>;
  const value = (name: string): string => {
    for (const [key, entry] of Object.entries(headers)) {
      if (key.toLowerCase() !== name) continue;
      if (Array.isArray(entry)) return String(entry[0] ?? "");
      return typeof entry === "string" ? entry : String(entry ?? "");
    }
    return "";
  };
  const autoSubmitted = value("auto-submitted").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  const precedence = value("precedence").trim().toLowerCase();
  if (precedence === "bulk" || precedence === "auto_reply" || precedence === "junk") {
    return true;
  }
  return Boolean(
    value("x-autoreply") ||
      value("x-autorespond") ||
      value("x-auto-response-suppress")
  );
}

export function parseAgentMailInboundEvent(
  payload: unknown
): AgentMailInboundEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const eventType = typeof record.event_type === "string" ? record.event_type : "";
  if (!eventType.startsWith("message.received")) return null;
  const message =
    record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>)
      : null;
  if (!message) return null;
  const asString = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";
  const inboxId = asString(message.inbox_id) || asString(record.inbox_id);
  const messageId = asString(message.message_id) || asString(record.message_id);
  if (!inboxId || !messageId) return null;
  // The SDK exposes the sender as `from` and the address list as `from_`;
  // normalize either into one bare address.
  const fromRaw =
    asString(message.from) ||
    (Array.isArray(message.from_)
      ? asString(message.from_[0])
      : asString(message.from_));
  const toRaw = Array.isArray(message.to)
    ? message.to.filter((item): item is string => typeof item === "string")
    : asString(message.to)
      ? [asString(message.to)]
      : [];
  const body =
    asString(message.text) || asString(message.extracted_text) || asString(message.preview);
  return {
    eventId: asString(record.event_id),
    inboxId,
    messageId,
    threadId: asString(message.thread_id) || asString(record.thread_id),
    from: fromRaw ? normalizeEmailAddress(fromRaw) : "",
    to: toRaw.map(value => normalizeEmailAddress(value)).filter(Boolean),
    subject: asString(message.subject) || "(no subject)",
    text: body,
    timestamp: new Date(asString(message.timestamp) || Date.now()),
    automated: hasAutomatedMailHeaders(message),
  };
}

/** Svix rejects signatures older than this (default tolerance). */
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Verifies an AgentMail (Svix-signed) webhook without pulling in the Svix SDK,
 * matching this module's fetch-only style. The signature is HMAC-SHA256 over
 * `${svix-id}.${svix-timestamp}.${rawBody}` with the `whsec_`-prefixed secret
 * base64-decoded, compared constant-time against every `v1,<sig>` entry in the
 * space-delimited header. Stale timestamps are rejected so a captured request
 * cannot be replayed later.
 */
export function verifyAgentMailWebhookSignature(input: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  secret: string;
  now?: number;
}): boolean {
  const secret = input.secret.trim();
  if (!secret) return false;
  const header = (name: string): string => {
    const value = input.headers[name] ?? input.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] ?? "" : value ?? "";
  };
  const id = header("svix-id");
  const timestamp = header("svix-timestamp");
  const signatureHeader = header("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return false;
  }
  const keyBase64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(keyBase64, "base64");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${input.rawBody}`)
    .digest("base64");
  const expectedBuffer = Buffer.from(expected);
  return signatureHeader.split(" ").some(part => {
    const candidate = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    const received = Buffer.from(candidate);
    return (
      received.length === expectedBuffer.length &&
      timingSafeEqual(received, expectedBuffer)
    );
  });
}
