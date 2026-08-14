const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
] as const;

export function getNeonAuthProxyUrl(baseUrl: string, pathSegments: string[], search = "") {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const path = pathSegments.map(segment => encodeURIComponent(segment)).join("/");
  return `${cleanBase}/${path}${search}`;
}

export function getNeonAuthProxyHeaders(headers: Record<string, string | string[] | undefined>) {
  const forwarded = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = headers[name];
    if (value) forwarded.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return forwarded;
}

export function getNeonAuthProxyBody(method: string | undefined, body: unknown) {
  if (method === "GET" || method === "HEAD" || body === undefined || body === null) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  return JSON.stringify(body);
}
