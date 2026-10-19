/**
 * Run-deadline racing and the transient gateway-retry loop for the workspace
 * agent. Both exist because a run is a bounded serverless invocation: the
 * deadline stops waiting on work that can no longer finish inside the
 * budget, and the retry loop keeps transient upstream failures from ever
 * reaching the user while claiming (and paying for) as few gateway attempts
 * as possible.
 */
import {
  chatWithAiGateway,
  AiGatewayClientError,
  type GatewayChatMessage,
  type GatewayToolDefinition,
} from "../aiGateway";
import { chatWithCustomModel, getActiveCustomModel } from "../byokGateway";
import { sleep } from "@shared/timing";
import type { CustomModel } from "../../drizzle/schema";

/** Raised when a tool call is still running as the run deadline passes. */
export class RunDeadlineExceeded extends Error {
  constructor() {
    super("the run deadline passed while a tool was still executing");
    this.name = "RunDeadlineExceeded";
  }
}

/**
 * Race a tool call against the run deadline. A single long call (a VM task,
 * a deploy) can outlast the 285s budget between the round-level checks, so
 * Vercel killed the function mid-tool with no closing reply. The work is a
 * factory so an already-expired deadline never starts the call at all -
 * its side effects must not begin once the run has effectively ended.
 * Losing the race stops *waiting*, not the tool - side effects already in
 * flight continue, and the caller closes the run so the reply persists in
 * the remaining margin.
 */
export async function raceToolDeadline<T>(
  work: () => Promise<T>,
  deadlineAtMs: number
): Promise<T> {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) throw new RunDeadlineExceeded();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RunDeadlineExceeded()),
          remainingMs
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Transient gateway failures worth an automatic in-run retry. */
const GATEWAY_RETRY_KINDS = new Set(["unavailable", "invalid_response"]);

/**
 * Upstream 429s are the one failure that reaches the user: the provider is
 * genuinely rate limiting, so retrying indefinitely would only extend the
 * lockout. A 429 gets this many immediate retries on the gateway's single
 * model before the throttle is reported.
 */
const RATE_LIMIT_RETRY_LIMIT = 3;

/**
 * Safety bound for the transient retry loop when a run carries no deadline
 * (standalone helpers, unit calls): a hard-down gateway must not spin forever.
 * Real runs always pass a deadline, and that deadline is the real bound.
 */
const TRANSIENT_RETRY_MAX_ATTEMPTS = 8;

/**
 * Base backoff between transient retries, doubling on each retry up to the
 * cap. The delay keeps a fast-failing gateway from being hammered: every
 * attempt claims another shared request allowance slot and one daily credit
 * before it is sent, so an unbounded instant loop can exhaust a workspace's
 * allowance or credits during an outage.
 */
let gatewayRetryBackoffBaseMs = 250;
const GATEWAY_RETRY_BACKOFF_CAP_MS = 4_000;

/** Test hook: zero the retry backoff so suites stay fast. */
export function setGatewayRetryBackoffForTests(ms: number | null) {
  gatewayRetryBackoffBaseMs = ms ?? 250;
}

/** Run-scoped retry bookkeeping shared across gateway rounds. */
export type GatewayRetryState = { rateLimitRetriesUsed: number };

/**
 * Calls the gateway with automatic retries for transient failures (network
 * blips, 5xx, empty completions). Retries are immediate - a blip recovers in
 * place instead of pausing the round - and keep going until the run deadline,
 * so a transient failure never surfaces to the user as an error by itself: the
 * run closes with the normal out-of-budget status (and a continuation, where
 * one is configured) once the budget is gone. A round that already streamed
 * text to the client is never retried: a fresh attempt would duplicate what
 * the user saw.
 */
export async function chatWithGatewayRetry(
  ownerId: number,
  messages: GatewayChatMessage[],
  options: {
    tools?: GatewayToolDefinition[];
    onChunk?: (chunk: string) => void;
    /** Streams the model's private reasoning (reasoning_content) if present. */
    onReasoning?: (chunk: string) => void;
    signal?: AbortSignal;
    /** Run deadline (epoch ms) - the bound on the transient retry loop. */
    deadlineAtMs?: number;
    /** Run-scoped state: the 429 retry budget is shared across rounds. */
    retryState?: GatewayRetryState;
    /**
     * True on an image turn before the attachment is dropped. A failed image
     * round must surface its error so the round can drop the attachment and
     * re-run on the text model, not keep re-sending an image the model
     * cannot take.
     */
    visionActive?: boolean;
    /**
     * The run's model route, resolved once by runWorkspaceAgent (null = the
     * built-in gateway). Reusing it keeps every round - and every transient
     * retry - from re-reading the active custom model from the database, and
     * a run can no longer switch providers mid-conversation when the
     * workspace's settings change between rounds. Undefined keeps the legacy
     * per-call lookup for direct callers of this helper.
     */
    customModel?: CustomModel | null;
  }
) {
  const gatewayOptions = (streamedChars: { count: number }) => ({
    tools: options.tools,
    ...(options.onReasoning ? { onReasoning: options.onReasoning } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onChunk
      ? {
          onChunk: (chunk: string) => {
            streamedChars.count += chunk.length;
            options.onChunk!(chunk);
          },
        }
      : {}),
  });
  let transientAttempts = 0;
  for (;;) {
    const streamedChars = { count: 0 };
    try {
      const route =
        options.customModel === undefined
          ? await getActiveCustomModel(ownerId)
          : options.customModel;
      return await (route
        ? chatWithCustomModel(route, messages, gatewayOptions(streamedChars))
        : chatWithAiGateway(ownerId, messages, gatewayOptions(streamedChars)));
    } catch (error) {
      // A user-requested stop aborts the in-flight request: never retry it.
      if (options.signal?.aborted) throw error;
      // A round that already streamed text is never retried.
      if (streamedChars.count > 0) throw error;
      const kind =
        error instanceof AiGatewayClientError ? error.kind : undefined;
      // Upstream 429: a fixed three immediate retries, and only then the
      // throttle is reported.
      if (kind === "rate_limit") {
        const used = options.retryState?.rateLimitRetriesUsed ?? 0;
        if (used >= RATE_LIMIT_RETRY_LIMIT) throw error;
        if (options.retryState)
          options.retryState.rateLimitRetriesUsed = used + 1;
        continue;
      }
      if (kind === undefined || !GATEWAY_RETRY_KINDS.has(kind)) throw error;
      // An image turn that errors drops the attachment and re-runs on the
      // text model (the round's vision recovery), so surface the failure
      // instead of retrying with the same unviewable image.
      if (options.visionActive) throw error;
      // Transient failure: retry after a short, capped backoff so fast
      // failures cannot hammer the gateway. With a deadline the loop is
      // bounded by the budget and then closes the run as out-of-budget (a
      // status message, plus a continuation where one is configured)
      // instead of surfacing an error the user cannot act on.
      transientAttempts += 1;
      const delay = Math.min(
        gatewayRetryBackoffBaseMs * 2 ** Math.min(transientAttempts - 1, 4),
        GATEWAY_RETRY_BACKOFF_CAP_MS
      );
      if (options.deadlineAtMs !== undefined) {
        if (Date.now() + delay >= options.deadlineAtMs)
          throw new RunDeadlineExceeded();
      } else if (transientAttempts >= TRANSIENT_RETRY_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(delay);
      if (options.signal?.aborted) throw error;
    }
  }
}
