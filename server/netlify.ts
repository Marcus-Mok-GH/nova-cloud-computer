/** Netlify API client for Nova's live website deployments.
 * Docs: https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/
 *
 * Nova publishes a workspace as a static website on Netlify's free tier:
 * creating a site gives a permanent `<name>.netlify.app` subdomain with SSL
 * that stays live 24/7 at no cost. The manual "file digest" deploy flow is
 * used: one request declares every file with its SHA1, then Netlify asks for
 * the bodies it does not already have on its CDN. */

import { createHash } from "crypto";
import { ENV } from "./_core/env";

const NETLIFY_API_BASE = "https://api.netlify.com/api/v1";

export function isNetlifyConfigured() {
  return ENV.netlifyApiToken.trim().length > 0;
}

export type NetlifySite = { id: string; name: string | null; url: string };

/** One file in a website deploy: its site path ("/index.html") and body bytes. */
export type NetlifyDeployFile = { path: string; content: Buffer };

async function netlifyFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${NETLIFY_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${ENV.netlifyApiToken}`,
    },
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(
      `Netlify responded with status ${response.status}${detail ? `: ${detail}` : "."}`
    );
  }
  return response;
}

/** Creates a free Netlify site with an auto-generated subdomain. */
export async function createNetlifySite(): Promise<NetlifySite> {
  const site = await netlifyFetch("/sites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).then(r => r.json() as Promise<{ id: string; name?: string; ssl_url?: string; url?: string }>);
  if (!site?.id) throw new Error("Netlify did not return a site id.");
  return { id: site.id, name: site.name ?? null, url: site.ssl_url || site.url || "" };
}

function sha1(content: Buffer) {
  return createHash("sha1").update(content).digest("hex");
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Deploys the given files to the site via the file-digest method and waits for
 * the deploy to finish processing. Netlify compares the digests against its
 * CDN and returns only the digests it still needs.
 */
export async function deployFilesToNetlifySite(
  siteId: string,
  files: NetlifyDeployFile[]
): Promise<{ deployId: string }> {
  const digests = new Map(files.map(file => [sha1(file.content), file]));
  const deploy = await netlifyFetch(`/sites/${siteId}/deploys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: Object.fromEntries(files.map(file => [file.path, sha1(file.content)])),
    }),
  }).then(r => r.json() as Promise<{ id: string; required?: string[]; state?: string }>);

  if (!deploy?.id) throw new Error("Netlify did not return a deployment id.");
  for (const digest of deploy.required ?? []) {
    const file = digests.get(digest);
    if (!file) throw new Error("Netlify asked for a file that was not part of the deploy.");
    // The upload path drops the leading slash and URL-encodes the rest.
    await netlifyFetch(`/deploys/${deploy.id}/files/${encodeURIComponent(file.path.slice(1))}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(file.content),
    });
  }

  // Deploys process asynchronously on Netlify's side: poll until live.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await netlifyFetch(`/deploys/${deploy.id}`)
      .then(r => r.json() as Promise<{ state?: string }>);
    if (state?.state === "ready") return { deployId: deploy.id };
    if (state?.state === "error") throw new Error("Netlify could not finish processing this deployment.");
    await sleep(2000);
  }
  throw new Error("Netlify is still processing this deployment - check back in a minute.");
}
