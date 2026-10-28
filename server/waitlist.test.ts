import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WAITLIST_TAG,
  createWaitlistHandler,
  normalizeWaitlistEmail,
  resetWaitlistRateLimit,
  subscribeToWaitlist,
} from "./waitlist";

function fakeRequest(body: Record<string, unknown>, ip = "203.0.113.7"): Request {
  return { body, headers: {}, ip } as unknown as Request;
}

function fakeResponse() {
  const response = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(value: unknown) {
      response.payload = value;
      return response;
    },
  };
  return response as unknown as Response & { statusCode: number; payload: unknown };
}

const next = (() => undefined) as NextFunction;

describe("normalizeWaitlistEmail", () => {
  it("trims and lowercases a usable address", () => {
    expect(normalizeWaitlistEmail("  Nimay@Example.COM ")).toBe("nimay@example.com");
  });

  it("rejects anything that is not a plausible address", () => {
    for (const value of ["", "nimay", "nimay@", "@example.com", "a b@example.com", "nimay@example", 42, null]) {
      expect(normalizeWaitlistEmail(value)).toBeNull();
    }
  });

  it("rejects addresses past the RFC length ceiling", () => {
    expect(normalizeWaitlistEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("subscribeToWaitlist", () => {
  it("reports an unconfigured provider without calling out", async () => {
    const fetchImpl = vi.fn();
    const result = await subscribeToWaitlist("nimay@example.com", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, status: 503, error: "waitlist-not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("tags the address through the API when a key is present", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 201 }));
    const result = await subscribeToWaitlist("nimay@example.com", {
      apiKey: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.buttondown.com/v1/subscribers");
    expect(JSON.parse(String(init.body))).toEqual({
      email_address: "nimay@example.com",
      tags: [WAITLIST_TAG],
      type: "regular",
    });
  });

  it("treats an already-subscribed address as success", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("That email is already subscribed.", { status: 400 })
    );
    const result = await subscribeToWaitlist("nimay@example.com", {
      apiKey: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true });
  });

  it("falls back to the public embed form when only a username is set", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/thanks" } }));
    const result = await subscribeToWaitlist("nimay@example.com", {
      username: "novacloud",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://buttondown.com/api/emails/embed-subscribe/novacloud");
  });

  it("surfaces provider failures as a 502", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const result = await subscribeToWaitlist("nimay@example.com", {
      apiKey: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, status: 502, error: "waitlist-provider-error" });
  });
});

describe("POST /api/waitlist", () => {
  beforeEach(() => {
    resetWaitlistRateLimit();
  });

  it("stores a valid address and answers ok", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 201 }));
    const handler = createWaitlistHandler({ apiKey: "token", fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = fakeResponse();
    await handler(fakeRequest({ email: "Nimay@Example.com" }), res, next);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
  });

  it("rejects a malformed address", async () => {
    const fetchImpl = vi.fn();
    const handler = createWaitlistHandler({ apiKey: "token", fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = fakeResponse();
    await handler(fakeRequest({ email: "nope" }), res, next);
    expect(res.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers ok without calling out when the honeypot is filled", async () => {
    const fetchImpl = vi.fn();
    const handler = createWaitlistHandler({ apiKey: "token", fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = fakeResponse();
    await handler(fakeRequest({ email: "bot@example.com", company: "Spam Inc" }), res, next);
    expect(res.statusCode).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throttles a flood from one address", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 201 }));
    const handler = createWaitlistHandler({ apiKey: "token", fetchImpl: fetchImpl as unknown as typeof fetch });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = fakeResponse();
      await handler(fakeRequest({ email: `person${attempt}@example.com` }), res, next);
      expect(res.statusCode).toBe(200);
    }
    const blocked = fakeResponse();
    await handler(fakeRequest({ email: "another@example.com" }), blocked, next);
    expect(blocked.statusCode).toBe(429);
  });
});