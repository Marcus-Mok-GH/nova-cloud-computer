import { E2B_WORKSPACE_DIR, type E2BSandboxLike } from "./e2b";

const BROWSE_OUTPUT_LIMIT = 8_000;
const BROWSE_COMMAND_TIMEOUT_MS = 120_000;
// The readiness probe runs before every browse command (CLI on PATH, ready
// marker, fast --version), so it must stay quick and cheap.
const BROWSE_READINESS_TIMEOUT_MS = 20_000;
// The one-time install runs detached in the sandbox, so this only covers
// *starting* the detached process; the install itself finishes on its own.
const BROWSE_SETUP_START_TIMEOUT_MS = 30_000;
// Readiness probe exit codes: 10 = CLI missing, 11 = Chrome not installed
// (or install still running), 12 = a previous install attempt FAILED.
const EXIT_CLI_MISSING = 10;
const EXIT_CHROME_MISSING = 11;
const EXIT_SETUP_FAILED = 12;
const SETUP_READY_MARKER = "$HOME/.nova-agent-browser-ready";
const SETUP_LOCK = "/tmp/nova-agent-browser-setup.lock";
const SETUP_LOG = "/tmp/nova-agent-browser-setup.log";
// Written when the detached install exits nonzero so a *failed* install is
// distinguishable from one that is still running.
const SETUP_FAILED = "/tmp/nova-agent-browser-setup-failed";

export type BrowserCommandResult = { ok: boolean; result: string };

type CommandOutcome = { exitCode: number; stdout: string; stderr: string };

/**
 * Cheap probe that answers one question: is the browser ready to use right
 * now? Distinct exit codes tell the caller *why* the sandbox is not ready,
 * so the heavy install only ever runs when it is actually needed.
 */
const READINESS_PROBE = [
  `if [ -f "${SETUP_FAILED}" ]; then echo "Last browser install attempt failed; tail of the setup log:"; tail -n 15 ${SETUP_LOG} 2>/dev/null; exit 12; fi`,
  "command -v agent-browser >/dev/null 2>&1 || exit 10",
  `[ ! -f "${SETUP_READY_MARKER}" ] && exit 11`,
  "agent-browser --version",
].join("\n");

/**
 * Idempotent per-sandbox bootstrap for the agent-browser CLI: installs the
 * npm package if missing, then Chrome for Testing with its Linux deps behind
 * a marker file. Two concurrent calls cannot race each other - the flock
 * makes the loser exit immediately instead of racing npm and the Chrome
 * download.
 */
const AGENT_BROWSER_SETUP = [
  "set -e",
  `exec 9>${SETUP_LOCK}`,
  'flock -n 9 || { echo "another install is already running; nothing to do"; exit 0; }',
  // A fresh attempt supersedes any recorded failure from a previous one.
  `rm -f ${SETUP_FAILED}`,
  "if ! command -v agent-browser >/dev/null 2>&1; then",
  '  echo "Installing agent-browser (one-time setup for this sandbox)..."',
  "  npm install -g agent-browser",
  "fi",
  `if [ ! -f "${SETUP_READY_MARKER}" ]; then`,
  '  echo "Downloading Chrome for Testing with its Linux dependencies (one-time setup)..."',
  "  agent-browser install --with-deps",
  `  touch "${SETUP_READY_MARKER}"`,
  "fi",
  "agent-browser --version",
].join("\n");

/**
 * The install must never run inline with an agent run. The run budget
 * (Vercel's 300s function limit) is far smaller than the install (npm package
 * + ~500MB Chrome download + apt deps), so an inline install always blew the
 * run deadline: the run died mid-install, the marker was never written, and
 * the next run started the same doomed install from scratch - browser use
 * timed out every single time. The detached form below starts the install as
 * a background sandbox command instead: it survives the end of the agent run
 * (and the sandbox itself is persistent), logs to a file inside the sandbox
 * so a later run can inspect why it failed, and the marker makes it one-time.
 */
const DETACHED_SETUP = `( ${AGENT_BROWSER_SETUP} ) > ${SETUP_LOG} 2>&1; code=$?; if [ "$code" -ne 0 ]; then echo "setup exit $code" | tee ${SETUP_FAILED} >> ${SETUP_LOG}; else echo "setup exit 0" >> ${SETUP_LOG}; fi`;

const SETUP_IN_PROGRESS_RESULT = [
  "The sandbox browser is not installed yet, so the browser command was not run.",
  "A one-time install (agent-browser CLI + Chrome for Testing) is now running in the background - it takes about 2-3 minutes, survives this conversation, and only happens once per sandbox.",
  "Tell the user this one-time setup is in progress, then wait about 2-3 minutes before running the same command again. Do not retry immediately and do not start a new install - it is already running.",
].join(" ");

/**
 * Runs one command in the sandbox and returns its exit code and output.
 * The E2B SDK throws CommandExitError instead of returning when a command
 * exits non-zero, so command failures are normalized back into an outcome;
 * transport errors (timeouts, disconnects) still throw.
 */
async function runSandboxCommand(
  sandbox: E2BSandboxLike,
  command: string,
  timeoutMs: number
): Promise<CommandOutcome> {
  try {
    const run = await sandbox.commands.run(command, {
      cwd: E2B_WORKSPACE_DIR,
      timeoutMs,
    });
    const outcome = run as Partial<CommandOutcome>;
    return {
      exitCode: outcome.exitCode ?? 0,
      stdout: outcome.stdout ?? "",
      stderr: outcome.stderr ?? "",
    };
  } catch (error) {
    // CommandExitError carries the same exitCode/stdout/stderr fields.
    const failed = error as Partial<CommandOutcome>;
    if (typeof failed.exitCode === "number") {
      return {
        exitCode: failed.exitCode,
        stdout: failed.stdout ?? "",
        stderr: failed.stderr ?? "",
      };
    }
    throw error;
  }
}

type MaybeCommandHandle = { disconnect?: () => Promise<void> };

/**
 * Starts the idempotent setup as a detached sandbox command and returns
 * immediately. The background command keeps running after the SDK disconnects
 * (and after the agent run that started it ends), which is what lets the
 * one-time install actually complete instead of being killed with the run.
 */
async function startDetachedSetup(sandbox: E2BSandboxLike): Promise<void> {
  const handle = (await sandbox.commands.run(DETACHED_SETUP, {
    cwd: E2B_WORKSPACE_DIR,
    background: true,
    timeoutMs: BROWSE_SETUP_START_TIMEOUT_MS,
  })) as unknown as MaybeCommandHandle;
  // The handle's event stream is no longer needed - drop it so nothing keeps
  // waiting on the install. The command itself keeps running.
  try {
    await handle?.disconnect?.();
  } catch {
    // Best effort: a failed disconnect does not affect the running install.
  }
}

function truncateOutput(value: string | undefined) {
  const text = (value ?? "").replace(/\u0000/g, "");
  if (text.length <= BROWSE_OUTPUT_LIMIT) return text;
  return `${text.slice(0, BROWSE_OUTPUT_LIMIT)}\n…(truncated)`;
}

/**
 * Fire-and-forget browser warmup for sandbox wake: starts the idempotent
 * detached setup so Chrome is usually installed before the agent even wants
 * to browse. Never throws and never blocks the run.
 */
export async function warmBrowserInBackground(
  sandbox: E2BSandboxLike
): Promise<void> {
  try {
    await startDetachedSetup(sandbox);
  } catch {
    // Warmup is best effort; the next browse call reports anything wrong.
  }
}

/**
 * Runs one agent-browser CLI command in the live workspace sandbox. The
 * readiness probe runs first: if the browser is not installed yet, the
 * one-time install is started in the background and the caller is told to
 * retry shortly; once the marker exists, commands run directly (120s
 * timeout). Failed probes, nonzero exits, and sandbox transport errors all
 * come back as model-ready retry guidance; never throws.
 */
export async function runBrowserCommand(
  sandbox: E2BSandboxLike,
  command: string
): Promise<BrowserCommandResult> {
  const prepared = command.trim().replace(/^agent-browser\s+/, "");
  if (!prepared)
    return {
      ok: false,
      result: "An agent-browser command is required, e.g. 'open https://example.com' or 'snapshot'.",
    };
  try {
    const probe = await runSandboxCommand(
      sandbox,
      READINESS_PROBE,
      BROWSE_READINESS_TIMEOUT_MS
    );
    if (probe.exitCode === EXIT_SETUP_FAILED) {
      // The previous install died (disk full, blocked download, ...). Surface
      // its actual error instead of silently looping on fresh installs: the
      // probe already printed the tail of the setup log. Start one new
      // attempt (a transient failure heals itself) and tell the model what to
      // do if the same error comes back.
      await startDetachedSetup(sandbox);
      const logTail = truncateOutput(probe.stdout);
      return {
        ok: false,
        result: [
          "The one-time sandbox browser install FAILED in a previous attempt:",
          logTail || "(no log captured)",
          "A fresh attempt is starting in the background now; wait 2-3 minutes and retry the browser command. If it fails again with the same error, inspect the sandbox with run_bash (`cat /tmp/nova-agent-browser-setup.log`, `agent-browser doctor`) and fix the root cause - common ones are no disk space or a blocked network for the npm/Chrome downloads. Tell the user what the log says.",
        ].join("\n\n"),
      };
    }
    if (
      probe.exitCode === EXIT_CLI_MISSING ||
      probe.exitCode === EXIT_CHROME_MISSING
    ) {
      await startDetachedSetup(sandbox);
      return { ok: false, result: SETUP_IN_PROGRESS_RESULT };
    }
    if (probe.exitCode !== 0) {
      const stderr = truncateOutput(probe.stderr);
      return {
        ok: false,
        result: [
          `The sandbox browser readiness check failed (exit code ${probe.exitCode}).`,
          stderr ? `stderr:\n${stderr}` : "",
          "Inspect the sandbox directly with run_bash, e.g. `cat /tmp/nova-agent-browser-setup.log` or `agent-browser doctor`, fix what it reports, and try again.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    }

    const run = await runSandboxCommand(
      sandbox,
      `agent-browser ${prepared}`,
      BROWSE_COMMAND_TIMEOUT_MS
    );
    const stdout = truncateOutput(run.stdout);
    const stderr = truncateOutput(run.stderr);
    const ok = run.exitCode === 0;
    const parts = [`Exit code ${run.exitCode}.`];
    parts.push(`stdout:\n${stdout || "(empty)"}`);
    if (stderr) parts.push(`stderr:\n${stderr}`);
    if (!ok)
      parts.push(
        "The browser command failed. Inspect the error above, fix the command, and try again. If Chrome itself failed to launch, retrying with `open <url> --args --no-sandbox` usually fixes container and VM sandboxes."
      );
    return { ok, result: parts.join("\n\n") };
  } catch (error) {
    return {
      ok: false,
      result: `The browser command could not run: ${
        error instanceof Error ? error.message : "unknown sandbox error"
      }. The sandbox may have timed out; ask the user to try again in a moment.`,
    };
  }
}
