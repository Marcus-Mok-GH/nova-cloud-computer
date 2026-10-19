import { ENV } from "./_core/env";
import { postSignedSelfCall } from "./selfCall";
import { trackBackgroundWork } from "./backgroundWork";
import { retryUntilAccepted } from "@shared/timing";

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
  return retryUntilAccepted({
    attempts: ADVANCE_SCHEDULE_ATTEMPTS,
    retryDelayMs: ADVANCE_RETRY_DELAY_MS,
    attempt: () =>
      postSignedSelfCall({
        url: `${baseUrl}/api/agent/queue/advance`,
        secret,
        body: "{}",
      }),
  });
}

/**
 * Nudges the queue: prefers a fresh self-invocation so each item gets a full
 * serverless budget, and falls back to draining it in-process when this
 * deployment has no self-invocation target (local dev, tests). The dynamic
 * import keeps the worker - which imports the inference API to build its
 * responses - out of this module's own graph, so there is no import cycle.
 */
export function kickPeakQueue(): void {
  // The whole hand-off is registered with the runtime: the self-invocation
  // fetch and the inline fallback both outlive the HTTP response that triggered
  // them, so the platform cannot freeze the invocation before the next item is
  // handed off.
  trackBackgroundWork(
    (async () => {
      if (await scheduleQueueAdvance()) return;
      try {
        const worker = await import("./peakQueueWorker");
        await worker.advancePeakQueue().catch(() => {});
      } catch (error) {
        console.warn("[Peak queue] Could not start the queue worker:", error instanceof Error ? error.message : error);
      }
    })()
  );
}
