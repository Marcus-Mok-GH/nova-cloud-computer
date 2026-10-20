import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { isSupportBotRequestPath } from "../server/_core/supportBotPath";

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
 */
export function isCoDeployedApiPath(path: string | string[] | undefined) {
  const segments = (Array.isArray(path) ? path : path ? [path] : []).flatMap(segment => segment.split("/")).filter(Boolean);
  return isTrpcPath(segments) || segments[0] === "chat" || segments[0] === "telegram" || segments[0] === "agent" || segments[0] === "agentmail" || segments[0] === "health" || segments[0] === "status" || segments[0] === "speech" || segments[0] === "v1" || segments[0] === "user-automations" || segments[0] === "scheduled"
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

export async function proxyNeonAuth(req: VercelRequest, res: VercelResponse, path: string) {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!baseUrl) return res.status(500).json({ error: "Neon Auth proxy is not configured." });

  const requestUrl = new URL(req.url ?? "/", "http://nova-proxy.local");
  const targetUrl = `${baseUrl.replace(/\/$/, "")}/${path}${requestUrl.search}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: getRequestHeaders(req.headers),
      body: getRequestBody(req.method, req.body),
      redirect: "manual",
    });
    forwardUpstreamResponse(upstream, res);
    // Authentication responses must never be reused after an OTP exchange. In
    // particular, a cached unauthenticated `get-session` response can otherwise
    // mask the session cookie set by a successful sign-in.
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("pragma", "no-cache");
    return res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("[Neon Auth proxy] Upstream request failed", error);
    return res.status(502).json({ error: "Neon Auth is temporarily unavailable." });
  }
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
