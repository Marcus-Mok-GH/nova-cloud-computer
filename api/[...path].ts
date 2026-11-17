import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { isSupportBotRequestPath } from "../server/_core/supportBotPath.js";

const require = createRequire(import.meta.url);

/**
 * Lazily loads the bundled Express app from `dist/server/app.cjs`. Deferred
 * until the first co-deployed request instead of at module import time, so
 * unit tests can import this module's pure helpers (path parsing, header
 * forwarding, etc.) without needing a production build on disk first - the
 * CI pipeline still runs `pnpm run build` before `pnpm test` for the real
 * request-dispatch coverage.
 */
let cachedModule: typeof import("../server/app") | null = null;
function getCoDeployedModule(): typeof import("../server/app") {
  if (!cachedModule) {
    cachedModule = require("../dist/server/app.cjs") as typeof import("../server/app");
  }
  return cachedModule;
}
function getCoDeployedApp(): typeof import("../server/app")["app"] {
  return getCoDeployedModule().app;
}

/**
 * Creates any missing tables before the co-deployed API handles a request.
 *
 * The deploy build already runs `db:migrate:deploy`, but that only helps when
 * a database URL is present at build time and the step succeeds. Re-running the
 * same idempotent migration from the prebuilt server bundle guarantees a
 * provisioned schema even when the build-time step was skipped (for example
 * when build and runtime environments expose different variables), so a first
 * request can never hit a missing table. The migration records applied runs in
 * `drizzle.__drizzle_migrations`, applies only what is pending, never rejects,
 * and caches its result for the life of the process.
 */
async function ensureSchemaReady() {
  await getCoDeployedModule().ensureDatabaseSchema();
}

/**
 * True when a request has to run the database-backed bootstrap (the schema
 * check and the recovery sweep).
 *
 * The public Q&A assistant never touches the database, so its requests skip
 * both: the widget keeps answering while the database is unavailable or over
 * quota. Every other route still runs them. The tRPC namespace is part of the
 * test so that only a real `support.ask` call is treated as database-free.
 */
export function needsDatabaseBootstrap(url: string | undefined): boolean {
  return !(isTrpcPathFromRequestUrl(url) && isSupportBotRequestPath(url));
}

/**
 * Any request that reaches the API is a chance to notice processes the platform killed earlier: a throttled,
 * fire-and-forget sweep reads the durable running-process ledger and resumes the orphans in a fresh invocation, so an
 * interrupted editor task or agent run keeps going without the user (or the main agent) having to restart it by hand.
 */
function kickProcessRecoverySweep() {
  try {
    getCoDeployedModule().kickRunningProcessRecovery();
  } catch {
    // The sweep is opportunistic: when the ledger (or the bundle) is not ready yet, the next request tries again.
  }
}

/** Runs the database-backed bootstrap, unless the request needs no database at all. */
async function prepareDatabaseForRequest(url: string | undefined) {
  if (!needsDatabaseBootstrap(url)) return;
  await ensureSchemaReady();
  kickProcessRecoverySweep();
}

const RESPONSE_HEADERS = ["cache-control", "content-type", "location", "pragma", "set-auth-jwt", "vary"] as const;
const REQUEST_HEADERS = ["accept", "accept-language", "authorization", "content-type", "cookie", "origin", "referer", "user-agent"] as const;

export function getNeonAuthPathFromCatchall(path: string | string[] | undefined) {
  const segments = (Array.isArray(path) ? path : path ? [path] : []).flatMap(segment => segment.split("/")).filter(Boolean);
  return segments[0] === "neon-auth" ? segments.slice(1).map(segment => encodeURIComponent(segment)).join("/") : null;
}

export function getNeonAuthPathFromRequestUrl(requestUrl: string | undefined) {
  const pathname = new URL(requestUrl ?? "/", "http://nova-proxy.local").pathname;
  return getNeonAuthPathFromCatchall(pathname.replace(/^\/api\/?/u, ""));
}

/**
 * Application RPC calls must be served by the co-deployed Nova API. Sending
 * them through an optional remote API service can separate the OTP proxy from
 * the JWT verifier and leave a successfully authenticated user unresolved.
 */
export function isTrpcPath(path: string | string[] | undefined) {
  const segments = (Array.isArray(path) ? path : path ? [path] : []).flatMap(segment => segment.split("/")).filter(Boolean);
  return segments[0] === "trpc";
}

export function isTrpcPathFromRequestUrl(requestUrl: string | undefined) {
  const pathname = new URL(requestUrl ?? "/", "http://nova-proxy.local").pathname;
  return isTrpcPath(pathname.replace(/^\/api\/?/u, ""));
}

/**
 * Requests that depend on Nova's own session and server-only provider settings
 * must remain co-deployed; they cannot safely be handled by an optional API
 * service running with different authentication or model configuration.
 *
 * Every `/api/chat/*` endpoint authenticates against Nova's own session and
 * mutates or reads Nova's own database (stream, delete, ...), so the whole
 * chat namespace is co-deployed rather than each endpoint individually.
 *
 * The `/api/user-automations/*` endpoints are the same shape: they authenticate
 * with Nova's own session, store rows in Nova's database, and register the
 * recurring job with Nova's own scheduling credentials, so creating or listing
 * an automation must never be handed to a differently-configured API service.
 * Their `/api/scheduled/*` callbacks run inside Nova too and must stay put for
 * the scheduled work to actually execute.
 *
 * `/api/speech` is different - it calls no database and needs no server-only
 * credentials - but it speaks text the caller already holds, so it authenticates
 * against Nova's own session. Handing it to a remote API service would send
 * signed-in users' message text to a different origin, so it stays co-deployed.
 *
 * `/api/whop/*` verifies Whop webhook signatures against this deployment's
 * `WHOP_WEBHOOK_SECRET` and updates local billing state, so it must stay
 * co-deployed rather than being proxied to a remote API service.
 *
 * `/api/waitlist` posts to the pre-launch mailing list with this deployment's
 * provider credentials, so it must stay co-deployed too.
 */
export function isCoDeployedApiPath(path: string | string[] | undefined) {
  const segments = (Array.isArray(path) ? path : path ? [path] : []).flatMap(segment => segment.split("/")).filter(Boolean);
  return isTrpcPath(segments) || segments[0] === "chat" || segments[0] === "telegram" || segments[0] === "agent" || segments[0] === "agentmail" || segments[0] === "whop" || segments[0] === "waitlist" || segments[0] === "health" || segments[0] === "status" || segments[0] === "speech" || segments[0] === "v1" || segments[0] === "user-automations" || segments[0] === "scheduled"
}

export function isCoDeployedApiPathFromRequestUrl(requestUrl: string | undefined) {
  const pathname = new URL(requestUrl ?? "/", "http://nova-proxy.local").pathname;
  return isCoDeployedApiPath(pathname.replace(/^\/api\/?/u, ""));
}

export function getRequestHeaders(headers: VercelRequest["headers"]) {
  const forwarded: Record<string, string> = {};
  for (const name of REQUEST_HEADERS) {
    const value = headers[name];
    if (value) forwarded[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return forwarded;
}

function getRequestBody(method: string | undefined, body: unknown) {
  if (method === "GET" || method === "HEAD" || body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return JSON.stringify(body);
}

function getSetCookieHeaders(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = getSetCookie?.call(headers);
  return values?.length ? values : (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
}

export function normalizeProxiedSessionCookie(cookie: string) {
  // The upstream auth service issues a third-party CHIPS cookie. Nova proxies
  // it through its own origin, so retain the secure session attributes while
  // removing upstream domain and partitioning directives for first-party use.
  return cookie
    .replace(/;\s*domain=[^;]+/giu, "")
    .replace(/;\s*partitioned/giu, "");
}

export function forwardUpstreamResponse(upstream: Response, res: VercelResponse) {
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  const cookies = getSetCookieHeaders(upstream.headers);
  if (cookies.length) res.setHeader("set-cookie", cookies.map(normalizeProxiedSessionCookie));
}

const AUTH_FAILOVER_CODES = new Set(["GENERIC_QUOTA_EXCEEDED", "QUOTA_EXCEEDED"]);
// Keep this set referenced: quota-shaped failure bodies must not leak through
// the proxy when a backup Neon Auth endpoint exists.
const AUTH_QUOTA_MESSAGE = /has exceeded the [a-z ]{0,32}quota\.?\s*Upgrade your plan/i;

export function getNeonAuthBaseUrls() {
  const primary = process.env.NEON_AUTH_BASE_URL?.trim().replace(/\/$/, "");
  if (!primary) return [];
  // Primary first: an expired/402 primary must not leak to the caller when a
  // backup endpoint is configured. Empty or duplicate entries are ignored, so
  // the chain stays [primary, backup, second backup] with unique origins.
  const extras = [
    process.env.NEON_AUTH_BACKUP_BASE_URL?.trim().replace(/\/$/, ""),
    process.env.NEON_AUTH_BACKUP2_BASE_URL?.trim().replace(/\/$/, ""),
  ].filter((url): url is string => Boolean(url) && url !== primary);
  const distinct = [...new Set(extras)];
  return distinct.length ? [primary, ...distinct] : [primary];
}

export function isNeonAuthFailoverResponse(status: number, body: string) {
  if (status !== 402 && status !== 429 && status !== 502 && status !== 503 && status !== 504) return false;
  return AUTH_QUOTA_MESSAGE.test(body) || body.includes("GENERIC_QUOTA_EXCEEDED") || body.includes("QUOTA_EXCEEDED");
}

/**
 * The origin this proxy is being reached at. Vercel supplies `host` and
 * `x-forwarded-proto` on every request; the browser's own Origin header is
 * compared against this, so every domain the deployment is served on (canonical,
 * aliases, previews) is matched without a configured allowlist of its own.
 */
export function getProxiedRequestOrigin(req: VercelRequest): string | null {
  const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  if (!host) return null;
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  const proto = forwardedProto?.split(",")[0]?.trim() || "https";
  return `${proto}://${host}`;
}

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * True when the request's claimed origin - Origin, falling back to Referer the
 * way better-auth does - names this deployment itself, i.e. the request came
 * from Nova's own pages rather than another site. The proxy must establish this
 * before it may re-present a refused request under an origin the upstream
 * trusts, because that substitution must never turn a cross-site POST into an
 * accepted one.
 */
export function isSameOriginProxiedRequest(req: VercelRequest): boolean {
  const expected = getProxiedRequestOrigin(req);
  if (!expected) return false;
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  const referer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
  const claimed = origin || safeOrigin(referer);
  if (!claimed) return false;
  try {
    return new URL(claimed).origin === new URL(expected).origin;
  } catch {
    // Covers the literal `Origin: null` from sandboxed contexts, which better-auth
    // also refuses.
    return false;
  }
}

/**
 * Neon Auth refuses any request whose Origin is missing from that auth project's
 * own trusted-origin allowlist. Projects are provisioned one at a time, so a
 * failover project created for standby duty still carries only its default
 * loopback entries - and once the primary runs over quota, every production
 * sign-in walks into that refusal and dies as "Invalid origin".
 *
 * The proxy is the CSRF boundary for this path: it can see the browser's real
 * origin, so it verifies the caller is this deployment and only then re-presents
 * the request under the loopback origin every Neon Auth project trusts by
 * default. A cross-site request never matches and keeps the upstream's refusal.
 */
export const TRUSTED_PROXIED_ORIGIN = "http://localhost:3000";

function isInvalidOriginRefusal(status: number, body: string) {
  if (status !== 403) return false;
  try {
    return JSON.parse(body)?.code === "INVALID_ORIGIN";
  } catch {
    return false;
  }
}

export async function proxyNeonAuth(req: VercelRequest, res: VercelResponse, path: string) {
  const baseUrls = getNeonAuthBaseUrls();
  if (!baseUrls.length) return res.status(500).json({ error: "Neon Auth proxy is not configured." });

  const requestUrl = new URL(req.url ?? "/", "http://nova-proxy.local");
  const search = requestUrl.search;
  let lastError: unknown = null;

  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = baseUrls[index];
    const targetUrl = `${baseUrl}/${path}${search}`;
    let responseBody: ArrayBuffer;
    let upstream: Response;
    try {
      const headers = getRequestHeaders(req.headers);
      upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: getRequestBody(req.method, req.body),
        redirect: "manual",
      });
      responseBody = await upstream.arrayBuffer();
      if (isInvalidOriginRefusal(upstream.status, Buffer.from(responseBody).toString("utf8")) && isSameOriginProxiedRequest(req)) {
        // The refusal came from this auth project's own allowlist, not from a
        // cross-site caller (that check just passed). better-auth rejects the
        // origin in middleware before the endpoint runs, so nothing has happened
        // yet and re-presenting the request cannot repeat a side effect.
        upstream = await fetch(targetUrl, {
          method: req.method,
          headers: { ...headers, origin: TRUSTED_PROXIED_ORIGIN },
          body: getRequestBody(req.method, req.body),
          redirect: "manual",
        });
        responseBody = await upstream.arrayBuffer();
      }
    } catch (error) {
      lastError = error;
      if (index < baseUrls.length - 1) {
        console.warn("[Neon Auth proxy] Primary upstream failed, trying backup", error);
        continue;
      }
      console.error("[Neon Auth proxy] Upstream request failed", error);
      return res.status(502).json({ error: "Neon Auth is temporarily unavailable." });
    }
    const body = Buffer.from(responseBody).toString("utf8");
    if (index < baseUrls.length - 1 && isNeonAuthFailoverResponse(upstream.status, body)) {
      console.warn("[Neon Auth proxy] Primary auth project is unavailable, failing over to backup", upstream.status);
      continue;
    }
    forwardUpstreamResponse(upstream, res);
    // Authentication responses must never be reused after an OTP exchange. In
    // particular, a cached unauthenticated `get-session` response can otherwise
    // mask the session cookie set by a successful sign-in.
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("pragma", "no-cache");
    return res.status(upstream.status).send(Buffer.from(responseBody));
  }
  return res.status(502).json({ error: "Neon Auth is temporarily unavailable." });
}

export async function proxyApiService(req: VercelRequest, res: VercelResponse, apiServiceUrl: string) {
  const requestUrl = new URL(req.url ?? "/", "http://nova-proxy.local");
  const targetUrl = `${apiServiceUrl}${requestUrl.pathname}${requestUrl.search}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: getRequestHeaders(req.headers),
      body: getRequestBody(req.method, req.body),
      redirect: "manual",
    });
    forwardUpstreamResponse(upstream, res);

    res.status(upstream.status);
    if (!upstream.body) return res.end();

    const stream = Readable.fromWeb(upstream.body as never);
    stream.on("error", error => {
      console.error("[API service proxy] Upstream response stream failed", error);
      if (!res.headersSent) res.status(502).json({ error: "API service response was interrupted." });
      else res.end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error("[API service proxy] Upstream request failed", error);
    if (!res.headersSent) return res.status(502).json({ error: "API service is temporarily unavailable." });
    return res.end();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const proxyPath = getNeonAuthPathFromCatchall(req.query.path) ?? getNeonAuthPathFromRequestUrl(req.url);
  if (proxyPath !== null) return proxyNeonAuth(req, res, proxyPath);

  if (isCoDeployedApiPath(req.query.path) || isCoDeployedApiPathFromRequestUrl(req.url)) {
    await prepareDatabaseForRequest(req.url);
    return getCoDeployedApp()(req, res);
  }

  const apiServiceUrl = process.env.API_SERVICE_URL?.replace(/\/$/, "").trim();
  if (apiServiceUrl) return proxyApiService(req, res, apiServiceUrl);

  await prepareDatabaseForRequest(req.url);
  return getCoDeployedApp()(req, res);
}
