/**
 * Proactive run-progress reporting for agent runs delivered over Telegram.
 *
 * The reporter owns the *what* and the *when*: it estimates an ETA from the
 * request text the moment a run starts ("I'll get this done within about
 * 15–30 seconds"), sends throttled status updates as the run progresses with
 * a revised ETA, and immediately notifies the user when the agent hits a
 * blocker — distinguishing snags it can work around on its own from ones
 * that need the user's action. Delivery goes through a sink callback, so the
 * Telegram webhook can pass `sendTelegramMessage` while tests pass a spy.
 */

export type EtaSeconds = { low: number; high: number };

/** Rounding steps that keep ETAs human ("15–30 seconds", "1–2 minutes"), never machine-y ("13–27 seconds"). */
const ETA_STEPS = [5, 10, 15, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1800];

function roundToEtaStep(seconds: number): number {
  return ETA_STEPS.find(step => seconds <= step) ?? ETA_STEPS[ETA_STEPS.length - 1];
}

/** Formats a seconds range as a natural human ETA window. */
export function formatEtaRange({ low, high }: EtaSeconds): string {
  const lo = roundToEtaStep(low);
  const hi = Math.max(lo, roundToEtaStep(high));
  if (hi >= 3600) {
    const hLo = Math.max(1, Math.round(lo / 3600));
    const hHi = Math.max(1, Math.round(hi / 3600));
    return hLo === hHi ? `${hLo} hour${hLo > 1 ? "s" : ""}` : `${hLo}–${hHi} hours`;
  }
  if (hi >= 60) {
    const mLo = Math.max(1, Math.round(lo / 60));
    const mHi = Math.max(1, Math.round(hi / 60));
    return mLo === mHi ? `${mLo} minute${mLo > 1 ? "s" : ""}` : `${mLo}–${mHi} minutes`;
  }
  return lo === hi ? `${lo} seconds` : `${lo}–${hi} seconds`;
}

/**
 * Rough task-complexity scoring from the request text. Not a promise — a
 * heuristic the run then revises with real progress. Research and VM work
 * dominate; plain workspace ops stay in seconds.
 */
export function estimateEtaForRequest(request: string): EtaSeconds {
  const text = request.toLowerCase();
  let seconds = 12;
  const bump = (patterns: RegExp[], by: number) => {
    if (patterns.some(pattern => pattern.test(text))) seconds += by;
  };
  bump([/research|find out|look up|search the web|latest|news|what happened|who is|compare|market|price of/], 110);
  bump([/deep|thorough|in-depth|analy[sz]e|investigat|report on|summar[iy][sz]e.*article|write .*essay/], 60);
  bump([/\bvm\b|sandbox|run (the )?code|install|execute|script|browser|scrape|crawl|benchmark|deploy/], 50);
  bump([/email|github|issue|pull request|\bpr\b|repo|composio|connector/], 25);
  bump([/create|write|draft|organize|rearrange|clean up|rename|move|delete/], 12);
  if (request.length > 400) seconds += 25;
  return { low: seconds * 0.6, high: seconds * 1.8 };
}

/**
 * Revised remaining-time estimate once real rounds have completed. Each
 * finished round predicts roughly one more (tool chains rarely stop cold),
 * minus the time already spent.
 */
export function remainingEtaSeconds(roundsCompleted: number, elapsedSeconds: number): number {
  const projected = 25 * (roundsCompleted + 1);
  return Math.min(900, Math.max(10, projected - elapsedSeconds));
}

export type BlockerKind = "user_action" | "recovering";

/** Failure text that means only the user can unblock this (credentials, connections, allowances). */
const USER_ACTION_PATTERNS = [
  /not connected|no longer connected/i,
  /settings and connect/i,
  /api key|credential|token|unauthorized|forbidden|permission denied/i,
  /exhausted|allowance/i,
];

/** Classifies a failed tool result: does the agent need the user, or is it handling it? */
export function classifyBlocker(toolResult: string): BlockerKind {
  return USER_ACTION_PATTERNS.some(pattern => pattern.test(toolResult)) ? "user_action" : "recovering";
}

/**
 * Trivial, instantly-self-correctable argument mistakes ("A file name is
 * required.") are not blocker material — the model retries within the same
 * run and mentioning them would just be noise.
 */
const TRIVIAL_FAILURE_PATTERNS = [
  /^invalid json/i,
  /is required\.$/i,
  /not found/i,
  /already exists/i,
  /must be/i,
  /cannot be empty/i,
  /missing/i,
];

/** True when a failed tool call is worth telling the user about. */
export function shouldNotifyBlocker(toolName: string, toolResult: string): boolean {
  if (TRIVIAL_FAILURE_PATTERNS.some(pattern => pattern.test(toolResult))) return false;
  // External-effect tools matter even on short failures; pure read-only
  // workspace mishaps the agent can silently retry.
  return !["list_workspace", "read_file"].includes(toolName);
}

/** A one-line, human version of a tool failure for a chat message. */
function summarizeToolResult(toolResult: string): string {
  const flat = toolResult.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

export type ProgressSink = (text: string) => Promise<void> | void;

/**
 * Throttled progress reporter for a single agent run. Ordinary status
 * updates respect `minIntervalMs` so long runs ping the user at a human
 * cadence; blockers always go out immediately, capped at three notices per
 * run so a flaky tool cannot flood the chat.
 */
export class AgentRunProgressReporter {
  private readonly startedAt = Date.now();
  private lastSentAt = 0;
  private roundsCompleted = 0;
  private toolsRun = 0;
  private blockerNotices = 0;
  private readonly sent: string[] = [];

  constructor(
    private readonly sink: ProgressSink,
    private readonly minIntervalMs = 20_000
  ) {}

  /** Every message delivered so far, in order — for logging and tests. */
  get messages(): readonly string[] {
    return this.sent;
  }

  private async deliver(text: string): Promise<void> {
    this.lastSentAt = Date.now();
    this.sent.push(text);
    await this.sink(text);
  }

  /** Sends the opening ETA message as soon as the run starts. */
  async runStarted(request: string): Promise<void> {
    const eta = formatEtaRange(estimateEtaForRequest(request));
    await this.deliver(`⏱️ On it — I'll get this done within about ${eta}. I'll update you as I go.`);
  }

  /**
   * Milestone update once a round of tools finished. Throttled: skipped when
   * the last notice is still fresh, so multi-round runs don't spam.
   */
  async roundCompleted(toolNames: string[], failedCount: number): Promise<void> {
    this.roundsCompleted += 1;
    this.toolsRun += toolNames.length;
    if (Date.now() - this.lastSentAt < this.minIntervalMs) return;
    const elapsedSeconds = Math.round((Date.now() - this.startedAt) / 1000);
    const remaining = remainingEtaSeconds(this.roundsCompleted, elapsedSeconds);
    const eta = formatEtaRange({ low: remaining * 0.7, high: remaining * 2 });
    const snag = failedCount > 0 ? `, ${failedCount} snag${failedCount === 1 ? "" : "s"} worked around` : "";
    await this.deliver(
      `⏳ Still on it — ${this.toolsRun} step${this.toolsRun === 1 ? "" : "s"} done so far${snag}. Revised ETA: about ${eta}.`
    );
  }

  /**
   * Blocker notice. Sent immediately (never throttled): "recovering" snags
   * say the agent is handling it, "user_action" ones say exactly what the
   * user needs to do. Capped at three notices per run.
   */
  async blocker(toolName: string, toolResult: string): Promise<void> {
    if (!shouldNotifyBlocker(toolName, toolResult)) return;
    this.blockerNotices += 1;
    if (this.blockerNotices > 3) return;
    const snippet = summarizeToolResult(toolResult);
    if (classifyBlocker(toolResult) === "user_action") {
      await this.deliver(
        `🚧 Blocker: ${toolName} — ${snippet}\nI can't finish this part without you. Reply here once it's sorted and I'll pick up right where I stopped.`
      );
    } else {
      await this.deliver(
        `⚠️ Heads-up: ${toolName} hit a snag (${snippet}). Working around it on my own — no action needed from you.`
      );
    }
  }
}
