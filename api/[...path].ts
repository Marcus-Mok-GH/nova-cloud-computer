import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const { app } = require("../dist/server/app.cjs") as typeof import("../server/app");

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
 */
export function isCoDeployedApiPath(path: string | string[] | undefined) {
  const segments = (Array.isArray(path) ? path : path ? [path] : []).flatMap(segment => segment.split("/")).filter(Boolean);
  return isTrpcPath(segments) || (segments[0] === "chat" && segments[1] === "stream");
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
  return cookie.replace(/;\s*domain=[^;]+/giu, "");
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

export default function handler(req: VercelRequest, res: VercelResponse) {
  const proxyPath = getNeonAuthPathFromCatchall(req.query.path) ?? getNeonAuthPathFromRequestUrl(req.url);
  if (proxyPath !== null) return proxyNeonAuth(req, res, proxyPath);

  if (isCoDeployedApiPath(req.query.path) || isCoDeployedApiPathFromRequestUrl(req.url)) return app(req, res);

  const apiServiceUrl = process.env.API_SERVICE_URL?.replace(/\/$/, "").trim();
  if (apiServiceUrl) return proxyApiService(req, res, apiServiceUrl);

  return app(req, res);
}
