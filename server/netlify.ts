/** Netlify API client for Nova's live website deployments.
 * Docs: https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/
 *
 * Nova publishes a workspace as a static website on Netlify's free tier:
 * creating a site gives a permanent `<name>.netlify.app` subdomain with SSL
 * that stays live 24/7 at no cost. The manual "file digest" deploy flow is
 * used: one request declares every file with its SHA1, then Netlify asks for
 * the bodies it does not already have on its CDN. */

import { createHash } from "crypto";
import { responseErrorDetail } from "@shared/_core/errors";
import { sleep } from "@shared/timing";
import { ENV } from "./_core/env";

const NETLIFY_API_BASE = "https://api.netlify.com/api/v1";

export function isNetlifyConfigured() {
  return ENV.netlifyApiToken.trim().length > 0;
}

export type NetlifySite = { id: string; name: string | null; url: string };

/** One file in a website deploy: its site path ("/index.html") and body bytes. */
export type NetlifyDeployFile = { path: string; content: Buffer };

/**
 * One authenticated Netlify API call. Non-2xx responses throw with the status
 * and the response's (capped) detail - unless `allow404`, which callers use
 * where a missing resource counts as success.
 */
async function netlifyFetch(
  path: string,
  init: RequestInit = {},
  { allow404 = false }: { allow404?: boolean } = {}
) {
  const response = await fetch(`${NETLIFY_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${ENV.netlifyApiToken}`,
    },
  });
  if (!response.ok && !(allow404 && response.status === 404)) {
    const detail = await responseErrorDetail(response);
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

/** Deletes a site entirely - its URL goes offline immediately. A 404 is treated as success (the site is already gone). */
export async function deleteNetlifySite(siteId: string) {
  await netlifyFetch(
    `/sites/${encodeURIComponent(siteId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${ENV.netlifyApiToken}` } },
    { allow404: true }
  );
}

/**
 * Writes environment variables onto a site (create-or-update per key). Netlify
 * stores them on the site itself, so they persist across redeploys and are
 * available to the site's build, functions and runtime injection. Keys that do
 * not exist yet are created; existing keys get their value replaced. Keys not
 * mentioned here are left untouched.
 */
export async function setSiteEnvVars(
  siteId: string,
  vars: Array<{ key: string; value: string }>
): Promise<void> {
  if (vars.length === 0) return;
  const existing = await netlifyFetch(`/sites/${encodeURIComponent(siteId)}/env`)
    .then(r => r.json() as Promise<Array<{ key: string }>>);
  const existingKeys = new Set((Array.isArray(existing) ? existing : []).map(entry => entry.key));
  for (const entry of vars) {
    const body = JSON.stringify({
      key: entry.key,
      // "all" makes the value apply to every deploy context.
      values: [{ value: entry.value, context: "all" }],
    });
    const path = `/sites/${encodeURIComponent(siteId)}/env`;
    await netlifyFetch(existingKeys.has(entry.key) ? `${path}/${encodeURIComponent(entry.key)}` : path, {
      method: existingKeys.has(entry.key) ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  }
}

function sha1(content: Buffer) {
  return createHash("sha1").update(content).digest("hex");
}

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
