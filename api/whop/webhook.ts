import { buffer } from "node:stream/consumers";
import { createRequire } from "node:module";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Dedicated Whop webhook entrypoint.
 *
 * Vercel's default body parser turns JSON into an object before Express sees
 * the request, which breaks Standard Webhooks signature checks that need the
 * exact raw bytes. This route disables that parser and verifies against the
 * buffered body directly.
 */
export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

const require = createRequire(import.meta.url);

function getWhopModule(): typeof import("../../server/app") {
  return require("../../dist/server/app.cjs") as typeof import("../../server/app");
}

/**
 * Creates any missing tables before the webhook writes subscription state.
 *
 * The deploy build already runs the migrations, but that only helps when a
 * database URL was present at build time and the step succeeded; the runtime
 * bootstrap (`server/migrate.ts`) is the safety net for a skipped or failed
 * build-time migration. Without it a cold function instance would insert into
 * a table that was never created, the write would 500, and Whop would retry a
 * webhook that can never succeed - silently losing the subscription update.
 * The bootstrap is idempotent, applies only pending migrations, never rejects,
 * and caches its result for the life of the process.
 */
async function ensureSchemaReady() {
  await getWhopModule().ensureDatabaseSchema();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method-not-allowed" });
  }

  const { handleWhopWebhook, isWhopConfigured } = getWhopModule();
  if (!isWhopConfigured() || !process.env.WHOP_WEBHOOK_SECRET?.trim()) {
    return res.status(404).json({ error: "whop-webhooks-disabled" });
  }

  try {
    await ensureSchemaReady();
    const rawBody = await buffer(req);
    const outcome = await handleWhopWebhook(rawBody, {
      "webhook-id": headerValue(req.headers["webhook-id"]),
      "webhook-timestamp": headerValue(req.headers["webhook-timestamp"]),
      "webhook-signature": headerValue(req.headers["webhook-signature"]),
    });
    return res.status(200).json({ ok: true, ...outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isSignatureFailure =
      /signature|Missing Whop webhook headers|timestamp is outside|payload is malformed|billing webhooks are not configured/i.test(
        message,
      );
    if (isSignatureFailure) {
      console.error("[Whop] webhook verification failed", error);
      return res.status(400).json({ error: "bad-signature" });
    }
    console.error("[Whop] webhook handling failed", error);
    return res.status(500).json({ error: "webhook-handler-failed" });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
