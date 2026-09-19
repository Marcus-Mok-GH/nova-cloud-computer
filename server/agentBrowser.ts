import { E2B_WORKSPACE_DIR, type E2BSandboxLike } from "./e2b";

const BROWSE_OUTPUT_LIMIT = 8_000;
const BROWSE_COMMAND_TIMEOUT_MS = 120_000;
// One-time setup per sandbox: installs the agent-browser CLI and downloads
// Chrome for Testing with its Linux system dependencies. Persistent sandboxes
// pause and resume with their disk intact, so this cost is paid once per
// sandbox, not per run.
const BROWSE_SETUP_TIMEOUT_MS = 240_000;
const SETUP_READY_MARKER = "$HOME/.nova-agent-browser-ready";

/**
 * Idempotent per-sandbox bootstrap for the agent-browser CLI: install the
 * npm package if missing, then download Chrome for Testing once (guarded by
 * a marker file so later calls skip straight to the version check).
 */
const AGENT_BROWSER_SETUP = [
  "set -e",
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

export type BrowserCommandResult = { ok: boolean; result: string };

type CommandOutcome = { exitCode: number; stdout: string; stderr: string };

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

function truncateOutput(value: string | undefined): string {
  const text = (value ?? "").replace(/\u0000/g, "");
  if (text.length <= BROWSE_OUTPUT_LIMIT) return text;
  return `${text.slice(0, BROWSE_OUTPUT_LIMIT)}\n…(truncated)`;
}

/**
 * Runs one agent-browser CLI command in the live workspace sandbox, running
 * the one-time browser bootstrap first. `command` is everything that follows
 * the binary name (e.g. 'open https://example.com'); a mistakenly repeated
 * 'agent-browser ' prefix is stripped. Returns a model-ready result with exit
 * code, stdout and stderr; never throws.
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
    const setup = await runSandboxCommand(
      sandbox,
      AGENT_BROWSER_SETUP,
      BROWSE_SETUP_TIMEOUT_MS
    );
    if (setup.exitCode !== 0) {
      const stderr = truncateOutput(setup.stderr);
      return {
        ok: false,
        result: [
          `The sandbox browser could not be set up (setup exit code ${setup.exitCode}).`,
          stderr ? `stderr:\n${stderr}` : "",
          "The one-time Chrome install failed - most likely a transient network issue in the sandbox. Tell the user and retry the browse in a moment.",
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
        "The browser command failed. Inspect the error above, fix the command, and try again."
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
