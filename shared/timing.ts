/**
 * Timing helpers shared by the server's polling and retry loops. Kept free of
 * any other dependency so the server, scripts, and client can all import them.
 */

/** Resolves after `ms` milliseconds. */
export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs `attempt` until it reports success, retrying at most `attempts` times
 * with a fixed `retryDelayMs` pause between tries (never after the last one).
 * Resolves true on the first accepted attempt, false once they are all spent.
 */
export async function retryUntilAccepted(input: {
  attempts: number;
  retryDelayMs: number;
  attempt: () => Promise<boolean>;
}): Promise<boolean> {
  for (let attempt = 1; attempt <= input.attempts; attempt += 1) {
    if (await input.attempt()) return true;
    if (attempt < input.attempts) await sleep(input.retryDelayMs);
  }
  return false;
}
