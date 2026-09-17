import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

process.env.NETLIFY_API_TOKEN = "test-token";

const { createNetlifySite, deployFilesToNetlifySite } = await import("./netlify");

const sha1 = (content: string) => createHash("sha1").update(content).digest("hex");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function routeFetch(handlers: Array<{ match: (url: string, method: string) => boolean; respond: () => Response | Promise<Response> }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const handler = handlers.find(h => h.match(url, method));
    if (!handler) throw new Error(`unexpected fetch: ${method} ${url}`);
    return handler.respond();
  });
}

describe("Netlify API client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("creates a site and prefers its SSL URL", async () => {
    globalThis.fetch = routeFetch([
      {
        match: (url, method) => url === "https://api.netlify.com/api/v1/sites" && method === "POST",
        respond: () => jsonResponse({ id: "site-1", name: "nova-random-words", ssl_url: "https://nova-random-words.netlify.app", url: "http://nova-random-words.netlify.app" }),
      },
    ]);
    const site = await createNetlifySite();
    expect(site).toEqual({ id: "site-1", name: "nova-random-words", url: "https://nova-random-words.netlify.app" });
    const [input, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(input)).toContain("/api/v1/sites");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-token");
  });

  it("deploys via file digests, uploads only required files, and waits for ready", async () => {
    const indexContent = "<html>hello</html>";
    const aboutContent = "about page";
    const puts: Array<{ path: string; body: string; contentType: string }> = [];
    globalThis.fetch = routeFetch([
      {
        match: (url, method) => url === "https://api.netlify.com/api/v1/sites/site-1/deploys" && method === "POST",
        respond: () => jsonResponse({ id: "dep-1", required: [sha1(indexContent)], state: "processing" }),
      },
      {
        match: (url, method) => url.startsWith("https://api.netlify.com/api/v1/deploys/dep-1/files/") && method === "PUT",
        respond: async () => {
          const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]);
          const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as RequestInit;
          const body = Buffer.from(init.body as Uint8Array).toString("utf8");
          puts.push({
            path: decodeURIComponent(url.replace("https://api.netlify.com/api/v1/deploys/dep-1/files/", "")),
            body,
            contentType: String((init.headers as Record<string, string>)["content-type"]),
          });
          return jsonResponse({});
        },
      },
      {
        match: url => url === "https://api.netlify.com/api/v1/deploys/dep-1",
        respond: () => jsonResponse({ state: "ready" }),
      },
    ]);

    const result = await deployFilesToNetlifySite("site-1", [
      { path: "/index.html", content: Buffer.from(indexContent, "utf8") },
      { path: "/nested/about.html", content: Buffer.from(aboutContent, "utf8") },
    ]);
    expect(result).toEqual({ deployId: "dep-1" });

    // The deploy request declared every file with its SHA1.
    const deployCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      call => String(call[0]).endsWith("/sites/site-1/deploys") && (call[1] as RequestInit).method === "POST"
    ) as [unknown, RequestInit];
    expect(JSON.parse(String(deployCall[1].body)).files).toEqual({
      "/index.html": sha1(indexContent),
      "/nested/about.html": sha1(aboutContent),
    });

    // Only the required file was uploaded, with the right path, bytes, and content type.
    expect(puts).toEqual([
      { path: "index.html", body: indexContent, contentType: "application/octet-stream" },
    ]);
  });

  it("rejects when the API responds with an error status", async () => {
    globalThis.fetch = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    await expect(createNetlifySite()).rejects.toThrow(/status 401/);
  });

  it("rejects when Netlify marks the deployment as errored", async () => {
    globalThis.fetch = routeFetch([
      {
        match: (url, method) => url === "https://api.netlify.com/api/v1/sites/site-1/deploys" && method === "POST",
        respond: () => jsonResponse({ id: "dep-2", required: [], state: "processing" }),
      },
      {
        match: url => url === "https://api.netlify.com/api/v1/deploys/dep-2",
        respond: () => jsonResponse({ state: "error" }),
      },
    ]);
    await expect(deployFilesToNetlifySite("site-1", [])).rejects.toThrow(/could not finish/);
  });
});
