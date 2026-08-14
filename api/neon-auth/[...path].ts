import type { VercelRequest, VercelResponse } from "@vercel/node";

const RESPONSE_HEADERS = ["cache-control", "content-type", "location", "pragma", "vary"] as const;
const REQUEST_HEADERS = ["accept", "accept-language", "content-type", "cookie", "origin", "referer", "user-agent"] as const;

function buildTargetUrl(baseUrl: string, pathSegments: string[], search: string) {
  return `${baseUrl.replace(/\/$/, "")}/${pathSegments.map(segment => encodeURIComponent(segment)).join("/")}${search}`;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!baseUrl) return res.status(500).json({ error: "Neon Auth proxy is not configured." });

  const pathValue = req.query.path;
  const pathSegments = Array.isArray(pathValue)
    ? pathValue
    : typeof pathValue === "string"
      ? [pathValue]
      : [];
  const requestUrl = new URL(req.url ?? "/", "http://nova-proxy.local");
  const targetUrl = buildTargetUrl(baseUrl, pathSegments, requestUrl.search);

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
    if (cookies.length) res.setHeader("set-cookie", cookies);

    const responseBody = Buffer.from(await upstream.arrayBuffer());
    return res.status(upstream.status).send(responseBody);
  } catch (error) {
    console.error("[Neon Auth proxy] Upstream request failed", error);
    return res.status(502).json({ error: "Neon Auth is temporarily unavailable." });
  }
}
