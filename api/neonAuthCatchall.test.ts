import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forwardUpstreamResponse,
  getNeonAuthPathFromCatchall,
  getNeonAuthPathFromRequestUrl,
  getRequestHeaders,
  isCoDeployedApiPath,
  isCoDeployedApiPathFromRequestUrl,
  isTrpcPath,
  isTrpcPathFromRequestUrl,
  normalizeProxiedSessionCookie,
  proxyApiService,
  proxyNeonAuth,
} from "./[...path]";

describe("Neon Auth catch-all dispatch", () => {
  it("reserves only the Neon Auth namespace while retaining its endpoint path", () => {
    expect(getNeonAuthPathFromCatchall(["neon-auth", "get-session"])).toBe("get-session");
    expect(getNeonAuthPathFromCatchall("neon-auth/magic-link/verify")).toBe("magic-link/verify");
    expect(getNeonAuthPathFromCatchall(["trpc", "auth.me"])).toBeNull();
  });

  it("falls back to the original URL when Vercel omits the catch-all query parameter", () => {
    expect(getNeonAuthPathFromRequestUrl("/api/neon-auth/get-session?neon_auth_session_verifier=one-time")).toBe(
      "get-session",
    );
    expect(getNeonAuthPathFromRequestUrl("/api/trpc/auth.me")).toBeNull();
  });

  it("identifies tRPC paths so authenticated account requests remain co-deployed", () => {
    expect(isTrpcPath(["trpc", "auth.me"])).toBe(true);
    expect(isTrpcPath("trpc/workspace.dashboard")).toBe(true);
    expect(isTrpcPath(["neon-auth", "get-session"])).toBe(false);
    expect(isTrpcPathFromRequestUrl("/api/trpc/auth.me?batch=1")).toBe(true);
  });

  it("keeps the authenticated chat namespace co-deployed", () => {
    expect(isCoDeployedApiPath(["trpc", "auth.me"])).toBe(true);
    expect(isCoDeployedApiPath(["chat", "stream"])).toBe(true);
    expect(isCoDeployedApiPath(["status"])).toBe(true);
    expect(isCoDeployedApiPath(["v1", "chat", "completions"])).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/status")).toBe(true);
    expect(isCoDeployedApiPath("chat/stream")).toBe(true);
    expect(isCoDeployedApiPath(["chat", "delete"])).toBe(true);
    expect(isCoDeployedApiPath("chat/delete")).toBe(true);
    expect(isCoDeployedApiPath(["chat", "other"])).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/chat/stream?request=1")).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/chat/delete")).toBe(true);
  });

  it("keeps automation creation and its scheduled callbacks co-deployed", () => {
    expect(isCoDeployedApiPath(["user-automations"])).toBe(true);
    expect(isCoDeployedApiPath(["user-automations", "plan"])).toBe(true);
    expect(isCoDeployedApiPath("user-automations/plan")).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/user-automations/plan")).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/user-automations/12")).toBe(true);
    expect(isCoDeployedApiPath(["scheduled", "user-automation"])).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/scheduled/automation")).toBe(true);
  });

  it("keeps the HMAC-guarded agent continuation namespace co-deployed", () => {
    expect(isCoDeployedApiPath(["agent", "continue"])).toBe(true);
    expect(isCoDeployedApiPath("agent/continue")).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/agent/continue")).toBe(true);
  });

  it("keeps the AgentMail inbound webhook co-deployed so it reaches the app", () => {
    expect(isCoDeployedApiPath(["agentmail", "webhook"])).toBe(true);
    expect(isCoDeployedApiPath("agentmail/webhook")).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/agentmail/webhook")).toBe(true);
  });

  it("keeps the Whop billing webhook co-deployed so it reaches the app", () => {
    expect(isCoDeployedApiPath(["whop", "webhook"])).toBe(true);
    expect(isCoDeployedApiPath("whop/webhook")).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/whop/webhook")).toBe(true);
  });
  it("keeps the pre-launch waitlist endpoint co-deployed so it reaches the app", () => {
    expect(isCoDeployedApiPath(["waitlist"])).toBe(true);
    expect(isCoDeployedApiPath("waitlist")).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/waitlist")).toBe(true);
  });

  it("normalizes upstream third-party cookie directives for the first-party session proxy", () => {
    expect(normalizeProxiedSessionCookie("session=value; Domain=neon.example; Path=/; HttpOnly; Secure; SameSite=None; Partitioned")).toBe(
      "session=value; Path=/; HttpOnly; Secure; SameSite=None",
    );
  });

  it("forwards browser bearer credentials to the protected API service", () => {
    expect(getRequestHeaders({ authorization: "Bearer signed-neon-jwt" } as any)).toEqual({
      authorization: "Bearer signed-neon-jwt",
    });
  });
});

describe("Proxy response forwarding", () => {
  const originalFetch = globalThis.fetch;
  const originalNeonAuthBaseUrl = process.env.NEON_AUTH_BASE_URL;

  function createUpstream(headers: Record<string, string>, body = "{}") {
    return new Response(body, {
      status: 200,
      headers: new Headers(headers),
    });
  }

  function createRes() {
    const headerStore = new Map<string, string[]>();
    let statusCode = 200;
    let ended = false;
    let sentBody: unknown;

    const res = {
      statusCode,
      headersSent: false,
      ended: false,
      setHeader(name: string, value: string | string[]) {
        const values = Array.isArray(value) ? value : [value];
        headerStore.set(name.toLowerCase(), values);
      },
      getHeader(name: string) {
        return headerStore.get(name.toLowerCase())?.[0];
      },
      getHeaderNames() {
        return Array.from(headerStore.keys());
      },
      getHeaders() {
        const out: Record<string, string> = {};
        for (const [key, values] of headerStore) {
          if (values.length === 1) out[key] = values[0];
          else out[key] = values.join(", ");
        }
        return out;
      },
      getSentBody() {
        return sentBody;
      },
      send(body: any) {
        ended = true;
        sentBody = body;
        res.ended = true;
        return res as any;
      },
      end() {
        ended = true;
        return res as any;
      },
      json(body: any) {
        return res.send(JSON.stringify(body));
      },
      status(code: number) {
        statusCode = code;
        res.statusCode = code;
        return res as any;
      },
      on(_event: string, _handler: (...args: any[]) => void) {
        return res as any;
      },
      once(_event: string, _handler: (...args: any[]) => void) {
        return res as any;
      },
      write(_chunk: any, _encoding?: BufferEncoding) {
        return true;
      },
      setEncoding(_encoding: BufferEncoding) {
        return res as any;
      },
      pipe(_destination: any) {
        return _destination;
      },
      emit(_event: string, ..._args: any[]) {
        return res as any;
      },
    } as any;

    return res;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalNeonAuthBaseUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = originalNeonAuthBaseUrl;
    vi.restoreAllMocks();
  });

  it("forwards an email OTP request and returns a successful upstream response", async () => {
    let requestedUrl = "";
    let requestBody = "";
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestBody = String(init?.body);
      return new Response('{"success":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    process.env.NEON_AUTH_BASE_URL = "https://auth.example/neondb/auth";

    const req = {
      method: "POST",
      url: "/api/neon-auth/email-otp/send-verification-otp?locale=en",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: { email: "member@example.com", type: "sign-in" },
    } as any;
    const res = createRes();

    await proxyNeonAuth(req, res, "email-otp/send-verification-otp");

    expect(requestedUrl).toBe(
      "https://auth.example/neondb/auth/email-otp/send-verification-otp?locale=en",
    );
    expect(JSON.parse(requestBody)).toEqual({ email: "member@example.com", type: "sign-in" });
    expect(res.statusCode).toBe(200);
    expect(res.getHeader("cache-control")).toBe("no-store, no-cache, must-revalidate, max-age=0");
    expect(Buffer.from(res.getSentBody() as Uint8Array).toString("utf8")).toBe('{"success":true}');
  });

  it("preserves Neon Auth's HTTP 500 status and response body", async () => {
    globalThis.fetch = async () =>
      new Response('{"code":"INTERNAL_SERVER_ERROR","message":"Email provider unavailable."}', {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    process.env.NEON_AUTH_BASE_URL = "https://auth.example/neondb/auth";

    const req = {
      method: "POST",
      url: "/api/neon-auth/email-otp/send-verification-otp",
      headers: { "content-type": "application/json" },
      body: { email: "member@example.com", type: "sign-in" },
    } as any;
    const res = createRes();

    await proxyNeonAuth(req, res, "email-otp/send-verification-otp");

    expect(res.statusCode).toBe(500);
    expect(res.getHeader("content-type")).toBe("application/json");
    expect(Buffer.from(res.getSentBody() as Uint8Array).toString("utf8")).toBe(
      '{"code":"INTERNAL_SERVER_ERROR","message":"Email provider unavailable."}',
    );
  });

  it("returns a safe configuration error when the auth URL is missing", async () => {
    delete process.env.NEON_AUTH_BASE_URL;
    globalThis.fetch = vi.fn(async () => new Response("{}"));

    const res = createRes();
    await proxyNeonAuth({ method: "GET", url: "/api/neon-auth/get-session", headers: {} } as any, res, "get-session");

    expect(res.statusCode).toBe(500);
    expect(res.getSentBody()).toBe('{"error":"Neon Auth proxy is not configured."}');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns a safe unavailable error when Neon Auth cannot be reached", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED private-address");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NEON_AUTH_BASE_URL = "https://auth.example/neondb/auth";

    const res = createRes();
    await proxyNeonAuth({ method: "GET", url: "/api/neon-auth/get-session", headers: {} } as any, res, "get-session");

    expect(res.statusCode).toBe(502);
    expect(res.getSentBody()).toBe('{"error":"Neon Auth is temporarily unavailable."}');
    expect(Buffer.from(res.getSentBody() as string).toString("utf8")).not.toContain("private-address");
  });

  it("forwards configured response headers and normalizes set-cookie through proxyNeonAuth", async () => {
    globalThis.fetch = async () =>
      createUpstream({
        "cache-control": "no-store",
        "content-type": "application/json",
        "set-cookie": "session=abc; Domain=neon.example; Path=/; Secure",
      });

    const req = {
      method: "POST",
      url: "/api/neon-auth/magic-link/verify",
      headers: { accept: "application/json", cookie: "session=opaque" },
      body: { email: "member@example.com" },
    } as any;

    process.env.NEON_AUTH_BASE_URL = "https://auth.example/neondb/auth";

    const res = createRes();
    await proxyNeonAuth(req, res, "magic-link/verify");

    expect(res.statusCode).toBe(200);
    expect(res.getHeader("cache-control")).toBe("no-store, no-cache, must-revalidate, max-age=0");
    expect(res.getHeader("pragma")).toBe("no-cache");
    expect(res.getHeader("content-type")).toBe("application/json");
    expect(res.getHeader("set-cookie")).toBe("session=abc; Path=/; Secure");
  });

  it("forwards configured response headers and normalizes set-cookie through proxyApiService", async () => {
    const upstream = createUpstream({
      "cache-control": "max-age=60",
      "content-type": "application/json",
      "set-cookie": "session=xyz; Domain=api.example; Path=/; HttpOnly",
    });

    globalThis.fetch = async () => upstream;

    const req = {
      method: "GET",
      url: "/v1/chat/completions",
      headers: { accept: "application/json" },
      body: undefined,
    } as any;

    const res = createRes();
    await proxyApiService(req, res, "https://api.example");

    expect(res.statusCode).toBe(200);
    expect(res.getHeader("cache-control")).toBe("max-age=60");
    expect(res.getHeader("content-type")).toBe("application/json");
    expect(res.getHeader("set-cookie")).toBe("session=xyz; Path=/; HttpOnly");
  });

  it("preserves upstream status and allowed headers through forwardUpstreamResponse", async () => {
    const upstream = new Response("{}", {
      status: 401,
      headers: new Headers({
        "cache-control": "no-store",
        "content-type": "application/json",
        vary: "Origin",
        pragma: "no-cache",
        location: "https://auth.example/sign-in",
        "set-auth-jwt": "opaque",
        "set-cookie": "session=abc; Domain=neon.example; Path=/; Secure",
      }),
    });

    const res = createRes();
    forwardUpstreamResponse(upstream, res);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader("cache-control")).toBe("no-store");
    expect(res.getHeader("content-type")).toBe("application/json");
    expect(res.getHeader("location")).toBe("https://auth.example/sign-in");
    expect(res.getHeader("set-auth-jwt")).toBe("opaque");
    expect(res.getHeader("set-cookie")).toBe("session=abc; Path=/; Secure");
  });
});
