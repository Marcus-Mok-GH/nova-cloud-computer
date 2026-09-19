import { describe, expect, it, vi } from "vitest";
import { runBrowserCommand } from "./agentBrowser";
import type { E2BSandboxLike } from "./e2b";

const fakeSandbox = (
  run: ReturnType<typeof vi.fn> = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
) =>
  ({ commands: { run } }) as unknown as E2BSandboxLike;

describe("runBrowserCommand", () => {
  it("bootstraps the sandbox once, then runs the command with its output fed back", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "agent-browser 1.0.0", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "page loaded", stderr: "" });
    const result = await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    expect(result.ok).toBe(true);
    expect(result.result).toContain("Exit code 0.");
    expect(result.result).toContain("stdout:\npage loaded");
    // First call is the idempotent bootstrap, second is the actual command.
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toBe("agent-browser open https://example.com");
    expect(run.mock.calls[1][1]).toEqual(
      expect.objectContaining({ cwd: "/home/user/workspace", timeoutMs: 120_000 })
    );
    // The bootstrap installs the CLI and Chrome behind a marker file.
    expect(run.mock.calls[0][0]).toContain("npm install -g agent-browser");
    expect(run.mock.calls[0][0]).toContain("agent-browser install --with-deps");
    expect(run.mock.calls[0][0]).toContain("$HOME/.nova-agent-browser-ready");
  });

  it("strips a mistakenly repeated agent-browser prefix from the command", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "1.0.0", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "- button 'Sign in' [@e2]", stderr: "" });
    const result = await runBrowserCommand(fakeSandbox(run), "agent-browser snapshot");
    expect(result.ok).toBe(true);
    expect(run.mock.calls[1][0]).toBe("agent-browser snapshot");
  });

  it("reports a failed bootstrap without running the command", async () => {
    const run = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "no space left" }));
    const result = await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("sandbox browser could not be set up");
    expect(result.result).toContain("no space left");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("feeds a nonzero command exit code back with the failure guidance", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "1.0.0", stderr: "" })
      .mockResolvedValue({ exitCode: 4, stdout: "", stderr: "element @e9 not found" });
    const result = await runBrowserCommand(fakeSandbox(run), "click @e9");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("Exit code 4.");
    expect(result.result).toContain("element @e9 not found");
    expect(result.result).toContain("fix the command, and try again.");
  });

  it("requires a command instead of guessing", async () => {
    const run = vi.fn();
    const result = await runBrowserCommand(fakeSandbox(run), "   ");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("An agent-browser command is required");
    expect(run).not.toHaveBeenCalled();
  });

  it("never throws - a sandbox transport error becomes a retry hint", async () => {
    const run = vi.fn(async () => {
      throw new Error("command timed out");
    });
    const result = await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("could not run");
    expect(result.result).toContain("try again in a moment");
  });
  it("uses the --version flag the CLI actually supports in the bootstrap", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "agent-browser 1.0.0", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "page loaded", stderr: "" });
    await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    // `agent-browser version` is NOT a valid command (exit 1) and would fail
    // every single browse call during bootstrap.
    expect(run.mock.calls[0][0]).toContain("agent-browser --version");
    expect(run.mock.calls[0][0]).not.toContain("agent-browser version\n");
  });

  it("surfaces a CommandExitError thrown by the SDK instead of hiding it as a transport error", async () => {
    // The E2B SDK throws on non-zero exits rather than returning; the thrown
    // error still carries exitCode/stdout/stderr.
    const exitError = Object.assign(new Error("exit status 1"), {
      exitCode: 1,
      stdout: "",
      stderr: "npm ERR! network unreachable",
    });
    const run = vi.fn(async () => {
      throw exitError;
    });
    const result = await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("could not be set up");
    expect(result.result).toContain("npm ERR! network unreachable");
  });

  it("reports exit code and stderr when the SDK throws for a failed command", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "1.0.0", stderr: "" })
      .mockRejectedValueOnce(
        Object.assign(new Error("exit status 3"), {
          exitCode: 3,
          stdout: "",
          stderr: "no browser is installed",
        })
      );
    const result = await runBrowserCommand(fakeSandbox(run), "snapshot");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("Exit code 3.");
    expect(result.result).toContain("no browser is installed");
  });
});
