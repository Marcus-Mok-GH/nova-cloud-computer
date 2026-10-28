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
    const rawBody = await buffer(req);
    const outcome = await handleWhopWebhook(rawBody, {
      "webhook-id": headerValue(req.headers["webhook-id"]),
      "webhook-timestamp": headerValue(req.headers["webhook-timestamp"]),
      "webhook-signature": headerValue(req.headers["webhook-signature"]),
    });
    return res.status(200).json({ ok: true, ...outcome });
  } catch (error) {
    console.error("[Whop] webhook verification failed", error);
    return res.status(400).json({ error: "bad-signature" });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
