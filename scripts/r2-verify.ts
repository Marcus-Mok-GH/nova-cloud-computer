/**
 * Verifies that the configured Cloudflare R2 bucket actually works.
 *
 * Run with: bun scripts/r2-verify.ts
 *
 * Reads the same four environment variables as `server/storage/r2.ts`
 * (`R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)
 * and performs a real write/read/delete round-trip against the bucket. This
 * exists so R2 can be proven working before any production traffic depends on
 * it - a misconfigured key would otherwise only surface as a failed upload.
 *
 * Exits non-zero on any failure. No mocks: every call hits the live bucket.
 */

import "dotenv/config";
import { randomUUID } from "crypto";

import {
  deleteObject,
  getObjectText,
  isBlobStorageConfigured,
  putObject,
  r2Config,
} from "../server/storage/r2";

const REQUIRED_VARS = [
  "R2_BUCKET",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

function fail(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

async function main() {
  console.log("Checking R2 configuration…");

  if (!isBlobStorageConfigured()) {
    const missing = REQUIRED_VARS.filter(name => !(process.env[name] ?? "").trim());
    fail(
      `blob storage is not configured. Missing: ${missing.join(", ") || "(unknown)"}.\n` +
        "Set these in Settings > Advanced (Secrets) or in .env, then re-run."
    );
  }

  const config = r2Config();
  if (!config) fail("r2Config() returned null despite isBlobStorageConfigured() being true");

  console.log(`  bucket:   ${config.bucket}`);
  console.log(`  endpoint: ${config.endpoint}`);
  console.log(`  key id:   ${config.accessKeyId.slice(0, 6)}…`);

  const key = `healthcheck/${randomUUID()}.txt`;
  const payload = `nova r2 healthcheck ${new Date().toISOString()}`;

  try {
    console.log(`\nPUT   ${key}`);
    await putObject(key, payload, "text/plain");
    console.log("      ok");

    console.log(`GET   ${key}`);
    const readBack = await getObjectText(key);
    if (readBack === null) fail("GET returned null for an object that was just written");
    if (readBack !== payload) {
      fail(`GET returned different content.\n  wrote: ${payload}\n  read:  ${readBack}`);
    }
    console.log("      ok (content matches)");

    console.log(`GET   ${key} (missing key returns null)`);
    const absent = await getObjectText(`healthcheck/${randomUUID()}-absent.txt`);
    if (absent !== null) fail("a missing key returned content instead of null");
    console.log("      ok");
  } finally {
    console.log(`\nDELETE ${key}`);
    try {
      await deleteObject(key);
      console.log("       ok");
    } catch (error) {
      console.error(`       failed to clean up test object: ${(error as Error).message}`);
    }
  }

  console.log("\nPASS  R2 is configured and reachable.");
}

main().catch(error => {
  fail((error as Error).message);
});