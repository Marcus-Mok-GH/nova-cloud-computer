import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The public Q&A assistant must keep answering while the database is down.
 *
 * The database here fails the way an exhausted quota makes it fail: every
 * query rejects. The widget is the one route that never needs the database,
 * so it has to answer anyway.
 */
vi.mock("./db/core", () => ({
  getDb: async () => null,
  requireDb: async () => {
    throw new Error("quota exceeded");
  },
  getDatabaseTime: async () => new Date(),
  isUniqueViolation: () => false,
}));

process.env.TOKENHARBOR_API_KEY = "thk_test_" + "k".repeat(40);
process.env.TOKENHARBOR_FALLBACK_MODEL = "disabled";
process.env.NOVA_SESSION_SECRET = "test-session-secret";

const { app } = await import("./app");
const { resetAiGatewayHealthCache } = await import("./aiGateway");
const { sdk } = await import("./_core/sdk");
const { COOKIE_NAME } = await import("@shared/const");

const realFetch = globalThis.fetch;

/** The gateway answers both the health probe and the completion. */
function stubGateway() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // Only the gateway is stubbed; the test's own request to the local server
    // still has to reach it.
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    if (url.endsWith("/models")) return new Response(null, { status: 200 });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Nova is a persistent cloud computer." } }],
        model: "deepseek-v4.1-flash:free",
      }),
      { status: 200 }
    );
  });
}

describe("public Q&A with an unavailable database", () => {
  let server: ReturnType<typeof app.listen>;
  let baseUrl = "";

  beforeAll(async () => {
    globalThis.fetch = stubGateway() as unknown as typeof fetch;
    resetAiGatewayHealthCache();
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it("answers an anonymous question", async () => {
    const response = await fetch(`${baseUrl}/api/trpc/support.ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        json: { messages: [{ role: "user", content: "What is Nova?" }] },
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result?: { data?: { json?: { answer?: string } } };
    };
    expect(payload.result?.data?.json?.answer).toBe(
      "Nova is a persistent cloud computer."
    );
  });

  it("answers a signed-in visitor whose session lookup would fail", async () => {
    // A valid session cookie makes every other route read the user row, which
    // rejects while the database is unavailable. The Q&A route ignores it.
    const token = await sdk.createSessionToken("neon-user-id", { name: "Sample" });
    const response = await fetch(`${baseUrl}/api/trpc/support.ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        json: { messages: [{ role: "user", content: "How do I get started?" }] },
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result?: { data?: { json?: { answer?: string } } };
    };
    expect(payload.result?.data?.json?.answer).toBe(
      "Nova is a persistent cloud computer."
    );
  });

  it("still fails a database-backed route", async () => {
    // The database-free path is scoped to the Q&A route on purpose: every other
    // route keeps reporting the outage rather than silently signing the user out.
    const token = await sdk.createSessionToken("neon-user-id", { name: "Sample" });
    const response = await fetch(`${baseUrl}/api/trpc/auth.me`, {
      method: "GET",
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });

    expect(response.status).not.toBe(200);
  });

  it("treats a URL that dispatches another procedure as database-backed", async () => {
    // The tRPC adapter dispatches on the last path segment, so this request
    // reaches `auth.me`. It must not inherit the Q&A route's database-free
    // context.
    const token = await sdk.createSessionToken("neon-user-id", { name: "Sample" });
    const response = await fetch(`${baseUrl}/api/trpc/support.ask/../auth.me`, {
      method: "GET",
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });

    expect(response.status).not.toBe(200);
  });
});
