import { waitUntil } from "@vercel/functions";

/**
 * Vercel's serverless runtime suspends a function the moment its HTTP response
 * has been delivered. Any promise left floating with `void work` freezes with
 * the invocation and only resumes if a later request happens to land on the
 * same instance — which is why Telegram replies used to arrive many minutes
 * late: the webhook acked instantly, the agent run froze, and the reply only
 * completed when unrelated traffic thawed the container.
 *
 * `waitUntil` binds the promise to the active invocation so the runtime keeps
 * the function alive until the work settles (bounded by the function's
 * maxDuration). Outside Vercel (local dev, unit tests) there is no request
 * context and `waitUntil` degrades to a no-op, so the caller-attached
 * `.catch` still governs the floating promise exactly as before.
 */
export function trackBackgroundWork<T>(work: Promise<T>): void {
  try {
    waitUntil(work);
  } catch {
    // No request context available (local dev/tests): fire-and-forget.
    void work;
  }
}
