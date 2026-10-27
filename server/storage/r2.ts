/**
 * Cloudflare R2 as Nova's blob store.
 *
 * `workspace_files.content` used to hold every uploaded file's bytes inline in
 * Neon Postgres, so each client read of a file was database network transfer -
 * the column that burned the free tier's 5 GB egress allowance. File bodies now
 * live in R2 and Postgres keeps only metadata plus the object key
 * (`workspace_files.storageKey`). R2 charges nothing for egress, so re-opening a
 * file no longer touches the database's transfer budget at all.
 *
 * R2 speaks the S3 API, so this is plain SigV4 request signing - no SDK, which
 * keeps the serverless bundle small. The signing itself is shared with the
 * existing memory mirror (`server/memories.ts`) via `signS3Request`.
 */

import { createHash, createHmac } from "crypto";

export type R2Config = {
  bucket: string;
  /** R2 account endpoint host, e.g. `<account>.r2.cloudflarestorage.com`. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** R2's SigV4 region is always `auto`. */
const R2_REGION = "auto";
const R2_SERVICE = "s3";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The configured bucket, or null when the deployment has no R2 credentials.
 *
 * Null is a supported state: a workspace with no R2 configured keeps storing
 * file bodies in `workspace_files.content` exactly as before, so this can be
 * rolled out without a flag day and dev/test environments need no credentials.
 */
export function r2Config(): R2Config | null {
  const bucket = (process.env.R2_BUCKET ?? "").trim();
  const endpoint = (process.env.R2_ENDPOINT ?? "").trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY ?? "").trim();
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey };
}

/** True when blob storage is configured, i.e. new uploads go to R2. */
export function isBlobStorageConfigured() {
  return r2Config() !== null;
}

function sha256Hex(data: string | Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** Encodes one S3 key segment per RFC 3986 (S3 canonical URI rules). */
function encodeKeyPath(key: string) {
  return key
    .split("/")
    .map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, c =>
      `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    ))
    .join("/");
}

/**
 * Builds a signed request for one R2 object. Exported for testing.
 *
 * `body` is hashed for the signature; pass the same bytes you send. An empty
 * body signs as the well-known empty-payload hash, which is what DELETE sends.
 */
export function signS3Request(
  config: R2Config,
  method: "GET" | "PUT" | "DELETE",
  key: string,
  body: string | Uint8Array,
  now: Date,
  contentType?: string
): { url: string; headers: Record<string, string> } {
  const host = config.endpoint;
  const canonicalUri = `/${encodeKeyPath(key)}`;
  const payloadHash = body.length ? sha256Hex(body) : EMPTY_PAYLOAD_SHA256;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 16);
  const dateStamp = amzDate.slice(0, 8);

  const headerLines: string[] = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ];
  if (contentType) headerLines.push(`content-type:${contentType}`);
  headerLines.sort();
  const signedHeaders = headerLines.map(line => line.split(":")[0]).join(";");
  const canonicalHeaders = `${headerLines.join("\n")}\n`;

  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), R2_REGION), R2_SERVICE),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const headers: Record<string, string> = {
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["Content-Type"] = contentType;

  return { url: `https://${host}${canonicalUri}`, headers };
}

/** SHA-256 of an empty payload - the constant an empty S3 body signs as. */
export const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async function request(
  method: "GET" | "PUT" | "DELETE",
  key: string,
  body: string | Uint8Array = "",
  contentType?: string
): Promise<Response> {
  const config = r2Config();
  if (!config) throw new Error("R2 blob storage is not configured");
  const signed = signS3Request(config, method, key, body, new Date(), contentType);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === "PUT" ? (body as BodyInit) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Stores one object. Throws when R2 is not configured or the write fails. */
export async function putObject(
  key: string,
  body: string | Uint8Array,
  contentType = "application/octet-stream"
): Promise<void> {
  const response = await request("PUT", key, body, contentType);
  if (!response.ok)
    throw new Error(
      `R2 PUT ${key} failed: ${response.status} ${await response.text().catch(() => "")}`
    );
}

/**
 * Reads one object back as text, or null when the key is genuinely absent.
 * Any other failure throws: silently returning null for a transient R2 error
 * would look like a file that lost its contents.
 */
export async function getObjectText(key: string): Promise<string | null> {
  const response = await request("GET", key);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`R2 GET ${key} failed: ${response.status}`);
  return await response.text();
}

/** Deletes one object. A missing key is a success - the goal is absence. */
export async function deleteObject(key: string): Promise<void> {
  const response = await request("DELETE", key);
  if (!response.ok && response.status !== 404)
    throw new Error(`R2 DELETE ${key} failed: ${response.status}`);
}

/**
 * The storage key for one workspace file. Deterministic and scoped by
 * workspace, so a key can never escape its owner's prefix, and a file's key
 * stays stable while the user renames or moves it between folders.
 */
export function workspaceFileKey(workspaceId: number, fileId: number): string {
  return `workspaces/${workspaceId}/files/${fileId}`;
}
