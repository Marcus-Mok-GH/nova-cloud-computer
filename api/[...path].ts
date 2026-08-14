import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app } = require("../dist/server/app.cjs") as typeof import("../server/app");

const RESPONSE_HEADERS = ["cache-control", "content-type", "location", "pragma", "set-auth-jwt", "vary"] as const;
const REQUEST_HEADERS = ["accept", "accept-language", "content-type", "cookie", "origin", "referer", "user-agent"] as const;

export function getNeonAuthPathFromCatchall(path: string | string[] | undefined) {
  const segments = (Array.isArray(path) ? path : path ? [path] : [])
    .flatMap(segment => segment.split("/"))
    .filter(Boolean);
  return segments[0] === "neon-auth" ? segments.slice(1).map(segment => encodeURIComponent(segment)).join("/") : null;
}

export function getNeonAuthPathFromRequestUrl(requestUrl: string | undefined) {
  const pathname = new URL(requestUrl ?? "/", "http://nova-proxy.local").pathname;
  return getNeonAuthPathFromCatchall(pathname.replace(/^\/api\/?/u, ""));
}

function getRequestHeaders(headers: VercelRequest["headers"]) {
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

async function proxyNeonAuth(req: VercelRequest, res: VercelResponse, path: string) {
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
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const cookies = getSetCookieHeaders(upstream.headers);
    if (cookies.length) res.setHeader("set-cookie", cookies.map(normalizeProxiedSessionCookie));
    return res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("[Neon Auth proxy] Upstream request failed", error);
    return res.status(502).json({ error: "Neon Auth is temporarily unavailable." });
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const proxyPath = getNeonAuthPathFromCatchall(req.query.path) ?? getNeonAuthPathFromRequestUrl(req.url);
  if (proxyPath !== null) return proxyNeonAuth(req, res, proxyPath);
  return app(req, res);
}
