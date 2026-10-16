import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ATTACHABLE_DATA_URI_CHARS,
  parseDesktopCommand,
  runDesktopBrowseCommand,
} from "./desktopBrowser";
import {
  resetSandboxCreationCount,
  type E2BClientLike,
  type E2BSandboxLike,
} from "./e2b";

const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
const failed = (stdout = "") => ({ exitCode: 1, stdout, stderr: "" });

/** Fragments of the command strings the module's probes and actions build. */
const probe = {
  readiness: "command -v Xvfb",
  display: "xdpyinfo",
  session: "pgrep -x xfce4-session",
  chromeWindow: "xdotool search --onlyvisible",
  chromeRunning: "pgrep -f google-chrome",
  chromeStop: "pgrep -f [c]hrome",
  scrot: "scrot --pointer",
};

type FakeOptions = {
  /** How many readiness probes fail before the desktop answers as ready. */
  failReadyTimes?: number;
  chrome?: boolean;
};

/**
 * A stand-in for a `desktop` template sandbox: it answers the module's probes
 * the way that image does (Chrome counts as running only once it has actually
 * been launched) and records every command it was asked to run.
 */
function fakeSandbox(options: FakeOptions = {}) {
  const commands: Array<{ command: string; options?: Record<string, unknown> }> =
    [];
  let readyChecks = 0;
  let chromeStarted = false;
  const chrome = options.chrome ?? true;
  const run = vi.fn(
    async (command: string, runOptions?: Record<string, unknown>) => {
      commands.push({ command, options: runOptions });
      if (
        command.includes("gtk-launch") ||
        command.includes("google-chrome --no-sandbox")
      )
        chromeStarted = true;
      if (command.includes(probe.readiness)) {
        readyChecks += 1;
        return readyChecks <= (options.failReadyTimes ?? 0) ? failed() : ok();
      }
      if (command.includes("pkill")) chromeStarted = false;
      if (command.includes(probe.chromeStop))
        return chrome && chromeStarted ? ok() : failed();
      if (command.includes(probe.display)) return ok();
      if (command.includes(probe.session)) return ok();
      if (command.includes(probe.chromeRunning))
        return chrome && chromeStarted ? ok() : failed();
      if (command.includes(probe.chromeWindow))
        return chrome && chromeStarted ? ok() : failed();
      if (command.includes("getactivewindow")) return ok("Example Domain\n");
      if (command.includes(probe.scrot)) return ok();
      return ok();
    }
  );
  const read = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
  const remove = vi.fn(async () => true);
  const kill = vi.fn(async () => true);
  const sandbox = {
    sandboxId: "sbx-desktop",
    commands: { run },
    files: { read, write: vi.fn(async () => true), remove },
    kill,
  } as unknown as E2BSandboxLike;
  return { sandbox, commands, run, read, remove, kill };
}

/** An E2B client whose create/connect spies are the ones handed back. */
function fakeClient(
  overrides: {
    create?: ReturnType<typeof vi.fn>;
    connect?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const create = overrides.create ?? vi.fn(async () => fakeSandbox().sandbox);
  const connect = overrides.connect ?? vi.fn(async () => fakeSandbox().sandbox);
  return {
    client: { create, connect } as unknown as E2BClientLike,
    create,
    connect,
  };
}

const commandsOf = (
  commands: Array<{ command: string; options?: Record<string, unknown> }>
) => commands.map(entry => entry.command);

afterEach(() => {
  resetSandboxCreationCount();
  delete process.env.E2B_MAX_SANDBOX_CREATIONS;
});

describe("parseDesktopCommand", () => {
  it("opens a URL in the Chrome app, promoting a scheme-less host", () => {
    expect(parseDesktopCommand("open https://example.com/x")).toMatchObject({
      kind: "open",
      url: "https://example.com/x",
    });
    expect(parseDesktopCommand("open example.com")).toMatchObject({
      kind: "open",
      url: "https://example.com",
    });
  });

  it("reads a capture, with or without a file name the model chose", () => {
    expect(parseDesktopCommand("screenshot")).toMatchObject({ kind: "capture" });
    expect(parseDesktopCommand("screenshot page.png")).toMatchObject({
      kind: "capture",
      name: "page.png",
    });
    expect(parseDesktopCommand("capture").kind).toBe("capture");
  });

  it("reads every pointer command", () => {
    expect(parseDesktopCommand("click 420 260")).toMatchObject({
      kind: "click",
      button: "left",
      x: 420,
      y: 260,
    });
    expect(parseDesktopCommand("double-click 10 20")).toMatchObject({
      kind: "click",
      button: "double",
    });
    expect(parseDesktopCommand("right-click 10 20")).toMatchObject({
      kind: "click",
      button: "right",
    });
    // No coordinates means "click wherever the pointer already is".
    expect(parseDesktopCommand("click")).toMatchObject({ kind: "click" });
    expect(parseDesktopCommand("move 5 6")).toMatchObject({
      kind: "move",
      x: 5,
      y: 6,
    });
    expect(parseDesktopCommand("scroll up 4")).toMatchObject({
      kind: "scroll",
      direction: "up",
      amount: 4,
    });
  });

  it("keeps quoted text whole and maps key names for xdotool", () => {
    expect(parseDesktopCommand('type "hello world"')).toMatchObject({
      kind: "type",
      text: "hello world",
    });
    expect(parseDesktopCommand("press ctrl+l")).toMatchObject({
      kind: "press",
      keys: "Control_L+l",
    });
    expect(parseDesktopCommand("press enter")).toMatchObject({
      kind: "press",
      keys: "Return",
    });
    expect(parseDesktopCommand("wait 2500")).toMatchObject({
      kind: "wait",
      ms: 2500,
    });
    expect(parseDesktopCommand("windows").kind).toBe("windows");
    expect(parseDesktopCommand("close")).toMatchObject({
      kind: "close",
      summary: "Closed every open browser tab",
    });
    // Trailing words the model may add are ignored: this verb is all tabs.
    expect(parseDesktopCommand("close browser").kind).toBe("close");
    expect(parseDesktopCommand("close all tabs").kind).toBe("close");
    expect(parseDesktopCommand("launch firefox example.com")).toMatchObject({
      kind: "launch",
      application: "firefox",
      url: "https://example.com",
    });
  });

  it("names the replacement for verbs the old browser CLI had", () => {
    const snapshot = parseDesktopCommand("snapshot");
    expect("error" in snapshot && snapshot.error).toContain("screenshot");
    const clickRef = parseDesktopCommand("click @e2");
    expect("error" in clickRef && clickRef.error).toContain("pixel position");
    const fill = parseDesktopCommand('fill @e3 "text"');
    expect("error" in fill && fill.error).toContain("type");
  });

  it("rejects malformed and unknown commands instead of guessing", () => {
    expect(parseDesktopCommand("   ")).toHaveProperty("error");
    expect(parseDesktopCommand("open")).toHaveProperty("error");
    expect(parseDesktopCommand("click 10")).toHaveProperty("error");
    expect(parseDesktopCommand("fly")).toHaveProperty("error");
  });
});

describe("runDesktopBrowseCommand", () => {
  it("connects to the workspace's existing desktop sandbox and captures the screen", async () => {
    const { sandbox, commands } = fakeSandbox();
    const connect = vi.fn(async () => sandbox);
    const { client, create } = fakeClient({ connect });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "open https://example.com",
      sandboxId: "sbx-chrome",
    });

    expect(result.ok).toBe(true);
    expect(connect).toHaveBeenCalledWith("sbx-chrome", expect.anything());
    expect(create).not.toHaveBeenCalled();
    const issued = commandsOf(commands);
    expect(issued).toContainEqual(
      expect.stringContaining("gtk-launch google-chrome https://example.com")
    );
    expect(issued.some(command => command.includes(probe.scrot))).toBe(true);
    expect(result.screenshot?.dataUri).toBe("data:image/png;base64,iVBORw==");
    expect(result.screenshot?.attachable).toBe(true);
    expect(result.result).toContain("Opened https://example.com");
    expect(result.result).toContain("Example Domain");
  });

  it("provisions the desktop sandbox once and records its id for later calls", async () => {
    const { sandbox, commands } = fakeSandbox();
    const onSandboxCreated = vi.fn(async () => undefined);
    const create = vi.fn(async (options?: Record<string, unknown>) => {
      expect(options).toMatchObject({ template: "desktop" });
      expect((options as { envs: Record<string, string> }).envs.DISPLAY).toBe(
        ":0"
      );
      expect(
        (options as { metadata: Record<string, string> }).metadata
      ).toMatchObject({ "nova.workspace": "7", "nova.browser": "true" });
      return sandbox;
    });
    const { client } = fakeClient({ create });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "screenshot",
      onSandboxCreated,
    });

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(onSandboxCreated).toHaveBeenCalledWith("sbx-desktop");
    // The X server, the window manager and Chrome all start detached, so the
    // desktop session outlives the request that booted it.
    const detached = commands.filter(entry => entry.options?.background === true);
    expect(detached.map(entry => entry.command)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Xvfb :0"),
        "startxfce4",
        expect.stringContaining("gtk-launch google-chrome"),
      ])
    );
    expect(result.result).toContain("first browse call");
  });

  it("revives a desktop sandbox whose session died instead of replacing it", async () => {
    const { sandbox, kill } = fakeSandbox({ failReadyTimes: 1 });
    const connect = vi.fn(async () => sandbox);
    const { client, create } = fakeClient({ connect });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "screenshot",
      sandboxId: "sbx-chrome",
    });

    expect(result.ok).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("replaces a desktop sandbox it cannot reach", async () => {
    const { sandbox } = fakeSandbox();
    const connect = vi.fn(async () => {
      throw new Error("sandbox not found");
    });
    const create = vi.fn(async () => sandbox);
    const { client } = fakeClient({ connect, create });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "screenshot",
      sandboxId: "sbx-gone",
    });

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("asks for a fresh machine only when the old one cannot be revived", async () => {
    const { sandbox, kill } = fakeSandbox({ failReadyTimes: 99 });
    const connect = vi.fn(async () => sandbox);
    const create = vi.fn(async () => fakeSandbox().sandbox);
    const { client } = fakeClient({ connect, create });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "screenshot",
      sandboxId: "sbx-dead",
    });

    expect(result.ok).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("marks a capture too large to attach while still returning it", async () => {
    const { sandbox } = fakeSandbox();
    // A photo-heavy page can blow past the attach limit: the capture is still
    // valid and still saved, it just never rides along as vision input.
    vi.mocked(sandbox.files.read).mockResolvedValue(
      new Uint8Array(MAX_ATTACHABLE_DATA_URI_CHARS)
    );
    const connect = vi.fn(async () => sandbox);
    const { client } = fakeClient({ connect });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "screenshot desktop.png",
      sandboxId: "sbx-chrome",
    });

    expect(result.ok).toBe(true);
    expect(result.screenshot?.dataUri.length).toBeGreaterThan(
      MAX_ATTACHABLE_DATA_URI_CHARS
    );
    expect(result.screenshot?.attachable).toBe(false);
    expect(result.screenshot?.suggestedName).toBe("desktop.png");
  });

  it("lists the desktop's windows without taking a capture", async () => {
    const { sandbox, commands, run } = fakeSandbox();
    run.mockImplementation(
      async (command: string, runOptions?: Record<string, unknown>) => {
        commands.push({ command, options: runOptions });
        if (command.includes(probe.readiness)) return ok();
        if (command.includes("xdotool search --onlyvisible --name"))
          return ok("Example Domain\nNova - Files\n");
        if (command.includes(probe.chromeWindow)) return ok();
        if (command.includes(probe.chromeRunning)) return ok();
        return ok();
      }
    );
    const connect = vi.fn(async () => sandbox);
    const { client } = fakeClient({ connect });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "windows",
      sandboxId: "sbx-chrome",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toContain("Example Domain");
    expect(result.screenshot).toBeUndefined();
    expect(
      commandsOf(commands).some(command => command.includes(probe.scrot))
    ).toBe(false);
  });

  it("stops Chrome in the workspace's desktop sandbox without touching it first", async () => {
    const { sandbox, commands } = fakeSandbox();
    const connect = vi.fn(async () => sandbox);
    const create = vi.fn();
    const { client } = fakeClient({ connect, create });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "close",
      sandboxId: "sbx-chrome",
    });

    expect(result.ok).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    // Closing must never boot a second desktop, and never relaunch the app it
    // was asked to stop.
    expect(create).not.toHaveBeenCalled();
    const issued = commandsOf(commands);
    expect(issued).toContainEqual(expect.stringContaining("pkill -f [c]hrome"));
    expect(issued.some(command => command.includes("gtk-launch"))).toBe(false);
    expect(issued.some(command => command.includes(probe.readiness))).toBe(false);
    // The report is text, so no capture rides along with it.
    expect(issued.some(command => command.includes(probe.scrot))).toBe(false);
    expect(result.screenshot).toBeUndefined();
    expect(result.result).toContain("Closed every open browser tab");
    expect(result.result).toContain("open <url>");
  });

  it("forces Chrome out when the term signal does not close it", async () => {
    const { sandbox, commands, run } = fakeSandbox();
    run.mockImplementation(async (command: string, runOptions?: Record<string, unknown>) => {
      commands.push({ command, options: runOptions });
      // Chrome answers every probe: the graceful kill never lands.
      if (command.includes("pkill")) return ok();
      if (command.includes(probe.chromeStop)) return ok();
      return ok();
    });
    const connect = vi.fn(async () => sandbox);
    const create = vi.fn();
    const { client } = fakeClient({ connect, create });
    vi.useFakeTimers();
    try {
      const pending = runDesktopBrowseCommand({
        client,
        workspaceId: 7,
        ownerId: 1,
        command: "close",
        sandboxId: "sbx-chrome",
      });
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.result).toContain("Chrome did not stop");
      expect(result.result).toContain("Run 'close' once more");
      expect(commandsOf(commands)).toContainEqual(
        expect.stringContaining("pkill -9 -f [c]hrome")
      );
      expect(create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not provision a desktop just to close a browser that was never opened", async () => {
    const { client, create, connect } = fakeClient();

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "close",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toContain("nothing to close");
    expect(connect).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("reports a desktop machine that has already gone as closed", async () => {
    const connect = vi.fn(async () => {
      throw new Error("sandbox not found");
    });
    const create = vi.fn();
    const { client } = fakeClient({ connect, create });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "close",
      sandboxId: "sbx-gone",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toContain("no tabs were left behind");
    expect(create).not.toHaveBeenCalled();
  });

  it("retries Chrome from the binary and reports when it never appears", async () => {
    const { sandbox, commands } = fakeSandbox({ chrome: false });
    const connect = vi.fn(async () => sandbox);
    const { client } = fakeClient({ connect });
    // The Chrome window has a 45s budget, twice over; drive the clock instead
    // of waiting it out.
    vi.useFakeTimers();
    try {
      const pending = runDesktopBrowseCommand({
        client,
        workspaceId: 7,
        ownerId: 1,
        command: "open https://example.com",
        sandboxId: "sbx-chrome",
      });
      await vi.advanceTimersByTimeAsync(200_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.result).toContain("Chrome did not open https://example.com");
      expect(result.result).toContain("once more");
      // The binary is tried straight away when the launcher produces no window.
      expect(
        commandsOf(commands).some(command =>
          command.includes("google-chrome --no-sandbox --disable-dev-shm-usage")
        )
      ).toBe(true);
      // The screen is captured either way, so the model can see what happened.
      expect(result.screenshot).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns an actionable error when the desktop machine cannot be created", async () => {
    const create = vi.fn(async () => {
      throw new Error("quota exhausted");
    });
    const { client } = fakeClient({ create });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "screenshot",
    });

    expect(result.ok).toBe(false);
    expect(result.result).toContain("could not run");
    expect(result.result).toContain("quota exhausted");
    expect(result.result).toContain("tell the user");
  });

  it("enforces Nova's sandbox-creation cap before creating a desktop machine", async () => {
    process.env.E2B_MAX_SANDBOX_CREATIONS = "0";
    resetSandboxCreationCount();
    const { client, create } = fakeClient();

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "screenshot",
    });

    expect(result.ok).toBe(false);
    expect(result.result).toContain("no-card safety limit");
    expect(create).not.toHaveBeenCalled();
  });

  it("never throws when the sandbox transport fails", async () => {
    const { sandbox } = fakeSandbox();
    vi.mocked(sandbox.commands.run).mockRejectedValue(
      new Error("command timed out")
    );
    const connect = vi.fn(async () => sandbox);
    const create = vi.fn(async () => {
      throw new Error("command timed out");
    });
    const { client } = fakeClient({ connect, create });

    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "screenshot",
      sandboxId: "sbx-chrome",
    });

    expect(result.ok).toBe(false);
    expect(result.result).toContain("could not run");
    expect(result.result).toContain("command timed out");
  });

  it("requires a command instead of guessing", async () => {
    const { client, create, connect } = fakeClient();
    const result = await runDesktopBrowseCommand({
      client,
      workspaceId: 7,
      ownerId: 1,
      command: "  ",
    });
    expect(result.ok).toBe(false);
    expect(result.result).toContain("desktop command is required");
    expect(connect).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
