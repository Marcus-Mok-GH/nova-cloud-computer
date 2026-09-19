import { describe, expect, it, vi } from "vitest";
import { runBrowserCommand, warmBrowserInBackground } from "./agentBrowser";
import type { E2BSandboxLike } from "./e2b";

const fakeSandbox = (
  run: ReturnType<typeof vi.fn> = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
) =>
  ({ commands: { run } }) as unknown as E2BSandboxLike;

describe("runBrowserCommand", () => {
  it("runs the command directly once the readiness probe passes", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "agent-browser 1.0.0", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "page loaded", stderr: "" });
    const result = await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    expect(result.ok).toBe(true);
    expect(result.result).toContain("Exit code 0.");
    expect(result.result).toContain("stdout:\npage loaded");
    // First call is the readiness probe, second is the actual command.
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toBe("agent-browser open https://example.com");
    expect(run.mock.calls[1][1]).toEqual(
      expect.objectContaining({ cwd: "/home/user/workspace", timeoutMs: 120_000 })
    );
    // The probe checks the CLI, the ready marker, and the supported flag.
    expect(run.mock.calls[0][0]).toContain("agent-browser --version");
    expect(run.mock.calls[0][0]).toContain("$HOME/.nova-agent-browser-ready");
    expect(run.mock.calls[0][1]).toEqual(
      expect.objectContaining({ timeoutMs: 20_000 })
    );
  });

  it("starts a detached install instead of blocking when the browser is not installed", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 11, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    const result = await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("not installed yet");
    expect(result.result).toContain("running in the background");
    expect(result.result).toContain("wait about 2-3 minutes");
    // The install runs detached (background) with the setup log attached.
    expect(run).toHaveBeenCalledTimes(2);
    const installCall = run.mock.calls[1];
    expect(installCall[0]).toContain("npm install -g agent-browser");
    expect(installCall[0]).toContain("agent-browser install --with-deps");
    expect(installCall[0]).toContain("nova-agent-browser-setup.log");
    expect(installCall[1]).toEqual(
      expect.objectContaining({ background: true })
    );
  });

  it("also installs in the background when the CLI itself is missing", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 10, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    const result = await runBrowserCommand(fakeSandbox(run), "snapshot");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("not installed yet");
    expect(run.mock.calls[1][1]).toEqual(
      expect.objectContaining({ background: true })
    );
  });

  it("reports a failed readiness probe with debugging guidance instead of guessing", async () => {
    const run = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "corrupted install" }));
    const result = await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("readiness check failed (exit code 1)");
    expect(result.result).toContain("corrupted install");
    expect(result.result).toContain("run_bash");
    expect(run).toHaveBeenCalledTimes(1);
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

  it("surfaces a CommandExitError thrown by the SDK instead of hiding it as a transport error", async () => {
    // The E2B SDK throws on non-zero exits rather than returning; the thrown
    // error still carries exitCode/stdout/stderr.
    const exitError = Object.assign(new Error("exit status 1"), {
      exitCode: 1,
      stdout: "",
      stderr: "agent-browser: broken pipe",
    });
    const run = vi.fn(async () => {
      throw exitError;
    });
    const result = await runBrowserCommand(fakeSandbox(run), "open https://example.com");
    expect(result.ok).toBe(false);
    expect(result.result).toContain("readiness check failed (exit code 1)");
    expect(result.result).toContain("agent-browser: broken pipe");
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

describe("warmBrowserInBackground", () => {
  it("starts the detached setup and never throws, even when the sandbox rejects it", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    await warmBrowserInBackground(fakeSandbox(run));
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("agent-browser install --with-deps"),
      expect.objectContaining({ background: true })
    );

    const brokenRun = vi.fn(async () => {
      throw new Error("sandbox unavailable");
    });
    await expect(warmBrowserInBackground(fakeSandbox(brokenRun))).resolves.toBeUndefined();
  });
});
