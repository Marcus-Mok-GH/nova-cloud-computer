import { afterEach, describe, expect, it } from "vitest";
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
    expect(isCoDeployedApiPath("chat/stream")).toBe(true);
    expect(isCoDeployedApiPath(["chat", "delete"])).toBe(true);
    expect(isCoDeployedApiPath("chat/delete")).toBe(true);
    expect(isCoDeployedApiPath(["chat", "other"])).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/chat/stream?request=1")).toBe(true);
    expect(isCoDeployedApiPathFromRequestUrl("/api/chat/delete")).toBe(true);
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
      send(body: any) {
        ended = true;
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
