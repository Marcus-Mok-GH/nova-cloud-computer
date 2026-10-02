import { createHmac } from "node:crypto";
import { ENV } from "./_core/env";
import { trackBackgroundWork } from "./backgroundWork";

/**
 * How many times the self-invocation is retried before falling back to inline
 * processing. Each queue item gets its own fresh invocation and its own
 * serverless budget; a dropped self-call must not stall the whole line.
 */
const ADVANCE_SCHEDULE_ATTEMPTS = 3;
const ADVANCE_RETRY_DELAY_MS = 1_000;

/**
 * Asks a fresh invocation to work the head of the peak queue. Returns true
 * when the hand-off was accepted, false when no self-invocation target is
 * configured (local dev/tests) so the caller can process inline instead.
 */
export async function scheduleQueueAdvance(): Promise<boolean> {
  const secret = ENV.agentContinueSecret;
  const baseUrl = ENV.publicBaseUrl;
  if (!secret || !baseUrl) return false;
  const body = "{}";
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  for (let attempt = 1; attempt <= ADVANCE_SCHEDULE_ATTEMPTS; attempt += 1) {
    const accepted = await scheduleQueueAdvanceOnce(baseUrl, signature, body);
    if (accepted) return true;
    if (attempt < ADVANCE_SCHEDULE_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, ADVANCE_RETRY_DELAY_MS));
    }
  }
  return false;
}

async function scheduleQueueAdvanceOnce(baseUrl: string, signature: string, body: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl}/api/agent/queue/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nova-signature": `sha256=${signature}` },
      body,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Nudges the queue: prefers a fresh self-invocation so each item gets a full
 * serverless budget, and falls back to draining it in-process when this
 * deployment has no self-invocation target (local dev, tests). The dynamic
 * import keeps the worker - which imports the inference API to build its
 * responses - out of this module's own graph, so there is no import cycle.
 */
export function kickPeakQueue(): void {
  void (async () => {
    if (await scheduleQueueAdvance()) return;
    try {
      const worker = await import("./peakQueueWorker");
      trackBackgroundWork(worker.advancePeakQueue().catch(() => {}));
    } catch (error) {
      console.warn("[Peak queue] Could not start the queue worker:", error instanceof Error ? error.message : error);
    }
  })();
}
