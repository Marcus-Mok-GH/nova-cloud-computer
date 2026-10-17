/**
 * HMAC signing for Nova's self-invoked endpoints.
 *
 * The continuation (`/api/agent/continue`), process-resume
 * (`/api/agent/process/resume`) and peak-queue (`/api/agent/queue/advance`)
 * endpoints are invoked by Nova itself so the work runs in a fresh serverless
 * invocation. They are not open routes: the caller signs the exact raw JSON
 * body with the agent-continue secret, and the endpoint verifies the
 * signature with a constant-time comparison before doing anything. Both sides
 * live here so the scheme cannot drift between them.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Header carrying the `sha256=<hex>` signature of the request body. */
export const NOVA_SIGNATURE_HEADER = "x-nova-signature";

/** The signature value (`sha256=<hex>`) for one exact request body. */
export function signSelfCallBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/**
 * True when `header` is the signature of `rawBody` under `secret`. The
 * comparison is constant-time so a bad signature cannot be probed byte by
 * byte; a length mismatch is rejected without calling timingSafeEqual.
 */
export function verifySelfCallSignature(input: {
  secret: string;
  rawBody: string;
  header: unknown;
}): boolean {
  const received = Buffer.from(String(input.header ?? ""));
  const expected = Buffer.from(signSelfCallBody(input.secret, input.rawBody));
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

/**
 * POSTs a signed self-call and reports whether the endpoint accepted it.
 * Failures (a dropped connection, a non-2xx response, the timeout) return
 * false instead of throwing, so callers can retry or fall back to inline
 * processing without special-casing the network.
 */
export async function postSignedSelfCall(input: {
  url: string;
  secret: string;
  body: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 8_000
  );
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [NOVA_SIGNATURE_HEADER]: signSelfCallBody(input.secret, input.body),
      },
      body: input.body,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
