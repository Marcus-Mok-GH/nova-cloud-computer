/**
 * The `browse` tool's desktop: a real Linux desktop (E2B's `desktop` template -
 * Ubuntu, XFCE and Chrome for Testing) in a persistent sandbox of its own,
 * where the agent opens the Chrome app and then looks at the screen the way a
 * person does.
 *
 * Every action ends with a screenshot of that desktop, and the run loop hands
 * the capture back to the model as vision input. That is the point of driving
 * a GUI: a click is chosen by reading the screen, so the page can be any page,
 * not only one an accessibility tree describes well.
 *
 * Why a sandbox of its own rather than the workspace VM: the VM runs E2B's
 * `base` template, which has no X server, no window manager and no Chrome.
 * Installing that stack costs a several-hundred-megabyte apt run *inside* an
 * agent run - the exact way this tool used to time out on every call. The
 * `desktop` image already ships all of it, boots in seconds, and is paused
 * rather than killed when idle, so the session survives between calls.
 *
 * The shell commands below are the ones E2B's own `@e2b/desktop` SDK issues
 * (Xvfb + startxfce4 for the session, gtk-launch for apps, scrot for captures,
 * xdotool for input), driven through Nova's existing E2B client so the project
 * keeps one E2B client and one pinned `e2b` version.
 */
import {
  DESKTOP_DISPLAY,
  desktopSandboxConfig,
  desktopSandboxTimeoutMs,
  reserveSandboxCreation,
  type E2BClientLike,
  type E2BSandboxLike,
} from "./e2b";

/** The screen the desktop session runs at. Chrome lays the page out at this
 *  size, so the capture doubles as the coordinate space the model clicks in:
 *  a desktop-class layout that is still cheap to send as vision input. */
export const SCREEN_WIDTH = 1280;
export const SCREEN_HEIGHT = 800;

const COMMAND_TIMEOUT_MS = 60_000;
/** Waiting for the X server, then the window manager, to come up. */
const DISPLAY_BOOT_TIMEOUT_MS = 20_000;
const SESSION_BOOT_TIMEOUT_MS = 45_000;
/** Chrome's first window: a cold start on a fresh sandbox, plus first-run UI. */
const CHROME_WINDOW_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 500;
const BROWSE_OUTPUT_LIMIT = 8_000;
/** The app the desktop tool opens. The template installs it as `google-chrome`. */
const CHROME_APP = "google-chrome";

/**
 * Largest capture worth attaching to the model's turn. A PNG of a photo-heavy
 * page can run to several megabytes; past this the screenshot is still saved
 * to the workspace, it just does not ride along as vision input.
 */
export const MAX_ATTACHABLE_DATA_URI_CHARS = 3_000_000;

export type DesktopCapture = {
  /** `data:image/png;base64,...` of the whole desktop screen. */
  dataUri: string;
  /** The file name the model asked for, when it named one. */
  suggestedName?: string;
  /** False when the capture is too large to send as vision input. */
  attachable: boolean;
};

export type DesktopBrowseOutcome = {
  ok: boolean;
  /** Model-facing text: what ran, and what the desktop is showing now. */
  result: string;
  /** The capture taken after the action, for the workspace and the model. */
  screenshot?: DesktopCapture;
};

export type DesktopAction =
  | { kind: "capture"; name?: string; summary: string }
  | { kind: "open"; url: string; summary: string }
  | {
      kind: "click";
      button: "left" | "right" | "double";
      x?: number;
      y?: number;
      summary: string;
    }
  | { kind: "move"; x: number; y: number; summary: string }
  | { kind: "scroll"; direction: "up" | "down"; amount: number; summary: string }
  | { kind: "type"; text: string; summary: string }
  | { kind: "press"; keys: string; summary: string }
  | { kind: "wait"; ms: number; summary: string }
  | { kind: "launch"; application: string; url?: string; summary: string }
  | { kind: "close"; summary: string }
  | { kind: "windows"; summary: string };

type CommandOutcome = { exitCode: number; stdout: string; stderr: string };

/** The key names xdotool expects, as `@e2b/desktop` maps them. */
const KEY_NAMES: Record<string, string> = {
  alt: "Alt_L",
  backspace: "BackSpace",
  caps_lock: "Caps_Lock",
  cmd: "Super_L",
  command: "Super_L",
  control: "Control_L",
  ctrl: "Control_L",
  del: "Delete",
  delete: "Delete",
  down: "Down",
  end: "End",
  enter: "Return",
  esc: "Escape",
  escape: "Escape",
  home: "Home",
  left: "Left",
  meta: "Meta_L",
  page_down: "Page_Down",
  page_up: "Page_Up",
  right: "Right",
  shift: "Shift_L",
  space: "space",
  super: "Super_L",
  tab: "Tab",
  up: "Up",
  win: "Super_L",
  windows: "Super_L",
};

/** Single-quotes a value for the sandbox shell, the way the desktop SDK does. */
function shellQuote(value: string) {
  if (!value) return "''";
  if (!/[^\w@%+=:,./-]/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Splits a command into tokens, keeping quoted strings whole. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

/** `example.com/x` -> `https://example.com/x`; a value that already carries a
 *  scheme, or looks like a local path, is left exactly as written. */
function normalizeUrl(value: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  if (/^[/~.]/.test(value)) return value;
  if (!value.includes(".")) return value;
  return `https://${value}`;
}

function coordinate(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function mapKeys(keys: string) {
  return keys
    .split("+")
    .map(part => KEY_NAMES[part.trim().toLowerCase()] ?? part.trim().toLowerCase())
    .filter(Boolean)
    .join("+");
}

/**
 * The tool's little command language. It deliberately keeps the two verbs that
 * carried over from the browser CLI this replaced (`open <url>`, `screenshot`),
 * and every error names the replacement for a verb that did not: the model
 * should never be left guessing what to type next.
 */
export function parseDesktopCommand(
  command: string
): DesktopAction | { error: string } {
  const trimmed = (command ?? "").trim();
  if (!trimmed)
    return {
      error:
        "A desktop command is required, e.g. 'open https://example.com', 'screenshot', or 'click 420 260'.",
    };
  const tokens = tokenize(trimmed);
  const verb = (tokens[0] ?? "").toLowerCase();
  const args = tokens.slice(1);

  switch (verb) {
    case "open": {
      const target = args[0];
      if (!target)
        return { error: "Give a URL to open, e.g. 'open https://example.com'." };
      const url = normalizeUrl(target);
      return { kind: "open", url, summary: `Opened ${url} in the Chrome app` };
    }
    case "screenshot":
    case "capture": {
      const name = args[0];
      return {
        kind: "capture",
        ...(name ? { name } : {}),
        summary: "Captured the desktop",
      };
    }
    case "click":
    case "double-click":
    case "doubleclick":
    case "right-click":
    case "rightclick": {
      const [rawX, rawY] = args;
      if (rawX?.startsWith("@"))
        return {
          error:
            "Element refs are gone: this tool clicks by pixel position. Read the coordinates off the screenshot you just got and use 'click <x> <y>'.",
        };
      const x = coordinate(rawX);
      const y = coordinate(rawY);
      if (rawX !== undefined && (x === undefined || y === undefined))
        return {
          error: `Give both coordinates in screen pixels, e.g. '${verb} 420 260'.`,
        };
      const button =
        verb === "right-click" || verb === "rightclick"
          ? "right"
          : verb === "click"
            ? "left"
            : "double";
      const noun =
        button === "double" ? "Double-clicked" : button === "right" ? "Right-clicked" : "Clicked";
      const where =
        x === undefined || y === undefined
          ? "the current pointer position"
          : `${x}, ${y}`;
      return {
        kind: "click",
        button,
        ...(x === undefined || y === undefined ? {} : { x, y }),
        summary: `${noun} at ${where}`,
      };
    }
    case "move": {
      const x = coordinate(args[0]);
      const y = coordinate(args[1]);
      if (x === undefined || y === undefined)
        return { error: "Give a position, e.g. 'move 420 260'." };
      return { kind: "move", x, y, summary: `Moved the pointer to ${x}, ${y}` };
    }
    case "scroll": {
      const direction = (args[0] ?? "down").toLowerCase();
      if (direction !== "up" && direction !== "down")
        return { error: "Scroll either 'up' or 'down', e.g. 'scroll down 3'." };
      const amount = Math.min(Math.max(coordinate(args[1]) ?? 1, 1), 20);
      return {
        kind: "scroll",
        direction,
        amount,
        summary: `Scrolled ${direction} ${amount} step${amount === 1 ? "" : "s"}`,
      };
    }
    case "type": {
      const text = args.join(" ");
      if (!text)
        return { error: "Give the text to type, e.g. 'type \"hello\"'." };
      return {
        kind: "type",
        text,
        summary: `Typed ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`,
      };
    }
    case "press":
    case "key": {
      const keys = args.join("+");
      if (!keys)
        return { error: "Give a key, e.g. 'press enter' or 'press ctrl+l'." };
      return { kind: "press", keys: mapKeys(keys), summary: `Pressed ${keys}` };
    }
    case "wait": {
      const ms = Math.min(Math.max(coordinate(args[0]) ?? 1_000, 100), 30_000);
      return { kind: "wait", ms, summary: `Waited ${ms}ms` };
    }
    case "launch": {
      const application = args[0];
      if (!application)
        return { error: "Name an application to launch, e.g. 'launch firefox'." };
      const url = args[1] ? normalizeUrl(args[1]) : undefined;
      return {
        kind: "launch",
        application,
        ...(url ? { url } : {}),
        summary: `Launched ${application}${url ? ` on ${url}` : ""}`,
      };
    }
    case "close":
      // Trailing words ("close browser", "close all tabs") are just the model
      // talking to itself: this verb always means every tab, every window.
      return { kind: "close", summary: "Closed every open browser tab" };
    case "windows":
      return { kind: "windows", summary: "Listed the desktop's windows" };
    case "snapshot":
    case "read":
    case "tree":
      return {
        error:
          "There is no accessibility snapshot (and no 'read') here: this is a GUI desktop, and every command answers with a screenshot you can look at. Run 'screenshot' to see the page.",
      };
    case "fill":
      return {
        error:
          "There is no 'fill' here: click the field with 'click <x> <y>' and then type with 'type \"text\"'.",
      };
    default:
      return {
        error: `Unknown desktop command '${tokens[0]}'. Use open <url>, screenshot, click <x> <y>, double-click, right-click, move <x> <y>, scroll up|down [n], type "text", press <key>, wait <ms>, launch <app>, windows, or close.`,
      };
  }
}

/**
 * Runs one command and returns its exit code and output. The E2B SDK throws
 * CommandExitError instead of returning when a command exits non-zero, so
 * command failures are normalized back into an outcome; transport errors
 * (timeouts, disconnects) still throw and are caught by the caller.
 */
async function runCommand(
  sandbox: E2BSandboxLike,
  command: string,
  timeoutMs = COMMAND_TIMEOUT_MS
): Promise<CommandOutcome> {
  try {
    const result = (await sandbox.commands.run(command, {
      timeoutMs,
    })) as Partial<CommandOutcome>;
    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
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
 * Starts a long-lived process (the X server, the window manager, Chrome) and
 * returns immediately. The background command keeps running after the SDK
 * disconnects - which is the whole point, since a desktop session that died
 * with the request would be useless.
 */
async function runDetached(sandbox: E2BSandboxLike, command: string) {
  const handle = (await sandbox.commands.run(command, {
    background: true,
    timeoutMs: 0,
  })) as unknown as MaybeCommandHandle;
  try {
    await handle?.disconnect?.();
  } catch {
    // Best effort: the process keeps running either way.
  }
}

/** Polls a probe command until it succeeds, or gives up at the deadline. */
async function waitForCommand(
  sandbox: E2BSandboxLike,
  probe: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await runCommand(sandbox, probe)).exitCode === 0) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

const DISPLAY_PROBE = `xdpyinfo -display ${DESKTOP_DISPLAY} >/dev/null 2>&1`;
const SESSION_PROBE =
  "pgrep -x xfce4-session >/dev/null 2>&1 && pgrep -x xfwm4 >/dev/null 2>&1";

/**
 * Everything the template must already provide. A fresh `desktop` sandbox
 * answers all of it once its session is up; a resumed one whose session did
 * not come back fails the X probes, and the caller restarts or replaces it.
 */
const DESKTOP_READY_PROBE = [
  "command -v Xvfb >/dev/null 2>&1 || exit 20",
  "command -v scrot >/dev/null 2>&1 || exit 21",
  "command -v xdotool >/dev/null 2>&1 || exit 22",
  "pgrep -x Xvfb >/dev/null 2>&1 || exit 23",
  "pgrep -x xfce4-session >/dev/null 2>&1 || exit 24",
  `${DISPLAY_PROBE} || exit 25`,
].join("\n");

async function isDesktopReady(sandbox: E2BSandboxLike): Promise<boolean> {
  try {
    return (await runCommand(sandbox, DESKTOP_READY_PROBE)).exitCode === 0;
  } catch {
    return false;
  }
}

/** Starts the X server and the XFCE session, the desktop SDK's own sequence. */
async function startDesktopSession(sandbox: E2BSandboxLike) {
  await runDetached(
    sandbox,
    `Xvfb ${DESKTOP_DISPLAY} -ac -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24 -retro -dpi 96 -nolisten tcp -nolisten unix`
  );
  if (!(await waitForCommand(sandbox, DISPLAY_PROBE, DISPLAY_BOOT_TIMEOUT_MS)))
    throw new Error("the desktop display did not start");
  await runDetached(sandbox, "startxfce4");
  if (!(await waitForCommand(sandbox, SESSION_PROBE, SESSION_BOOT_TIMEOUT_MS)))
    throw new Error("the desktop session did not start");
}

const CHROME_RUNNING_PROBE = `pgrep -f ${CHROME_APP} >/dev/null 2>&1`;
/** A Chrome process is not enough: the window has to be on screen, or the
 *  capture the model is about to read would show an empty desktop. */
const CHROME_WINDOW_PROBE = [
  CHROME_RUNNING_PROBE,
  "xdotool search --onlyvisible --class Google-chrome >/dev/null 2>&1 && exit 0",
  "xdotool search --onlyvisible --name Chrome >/dev/null 2>&1 && exit 0",
  "exit 1",
].join("\n");

/**
 * Chrome, as a process pattern. The name is wrapped in brackets so the shell
 * that runs `pkill` - whose own command line carries this very pattern - does
 * not match itself and die with the browser it was asked to stop.
 */
const CHROME_MATCH = "[c]hrome";
const CHROME_KILL = `pkill -f ${CHROME_MATCH}`;
const CHROME_KILL_FORCE = `pkill -9 -f ${CHROME_MATCH}`;
const CHROME_PROBE = `pgrep -f ${CHROME_MATCH} >/dev/null 2>&1`;
/** Chrome's grace period on the term signal before it is forced out. */
const CHROME_STOP_TIMEOUT_MS = 10_000;

/** The launcher form, which is what the desktop's own application menu runs. */
function chromeLauncherCommand(url?: string) {
  return `gtk-launch ${CHROME_APP}${url ? ` ${shellQuote(url)}` : ""}`;
}

/**
 * Starts Chrome (at `url` when one is given) and waits for its window. The
 * launcher is tried first; when nothing appears, the binary is started
 * directly - the container-friendly form with the sandbox disabled - before
 * the call is reported as failed.
 */
async function launchChrome(
  sandbox: E2BSandboxLike,
  url?: string
): Promise<boolean> {
  await runDetached(sandbox, chromeLauncherCommand(url));
  if (await waitForCommand(sandbox, CHROME_WINDOW_PROBE, CHROME_WINDOW_TIMEOUT_MS))
    return true;
  await runDetached(
    sandbox,
    `${CHROME_APP} --no-sandbox --disable-dev-shm-usage${
      url ? ` ${shellQuote(url)}` : ""
    }`
  );
  return waitForCommand(sandbox, CHROME_WINDOW_PROBE, CHROME_WINDOW_TIMEOUT_MS);
}

/**
 * Makes sure the Chrome app is on screen: with a URL, the page is opened
 * (as a new tab when Chrome is already running, which is what keeps the
 * session - and the user's logins - between calls).
 */
async function ensureChrome(
  sandbox: E2BSandboxLike,
  url?: string
): Promise<boolean> {
  if (url) return launchChrome(sandbox, url);
  if ((await runCommand(sandbox, CHROME_RUNNING_PROBE)).exitCode === 0) return true;
  return launchChrome(sandbox);
}

/** The title of the focused window, when the session reports one. */
async function activeWindowTitle(sandbox: E2BSandboxLike): Promise<string> {
  const outcome = await runCommand(
    sandbox,
    "xdotool getactivewindow getwindowname 2>/dev/null || true"
  );
  return (outcome.stdout.split("\n")[0] ?? "").trim().slice(0, 120);
}

/**
 * Stops the Chrome app, which closes every tab it holds. `pkill` gets the term
 * signal first; anything still alive when the grace period runs out is forced,
 * because the whole point of this verb is to give the memory back. Returns
 * false only when Chrome is still there after both.
 */
async function stopChrome(sandbox: E2BSandboxLike): Promise<boolean> {
  await runCommand(sandbox, CHROME_KILL);
  const deadline = Date.now() + CHROME_STOP_TIMEOUT_MS;
  for (;;) {
    if ((await runCommand(sandbox, CHROME_PROBE)).exitCode !== 0) return true;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  await runCommand(sandbox, CHROME_KILL_FORCE);
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  return (await runCommand(sandbox, CHROME_PROBE)).exitCode !== 0;
}

/** Lists the desktop's visible windows, so the model can tell what is open. */
async function listWindows(sandbox: E2BSandboxLike): Promise<string> {
  const outcome = await runCommand(
    sandbox,
    [
      'xdotool search --onlyvisible --name ".*" 2>/dev/null | while read -r id; do',
      '  name=$(xdotool getwindowname "$id" 2>/dev/null)',
      '  [ -n "$name" ] && echo "$name"',
      "done | sort -u",
    ].join("\n")
  );
  return outcome.stdout.trim();
}

/**
 * Captures the whole screen and returns it as a PNG data URI. The temp file is
 * removed inside the sandbox so repeated captures cannot fill its disk.
 */
async function captureScreen(sandbox: E2BSandboxLike): Promise<string> {
  const path = `/tmp/nova-browse-${Math.random().toString(36).slice(2, 10)}.png`;
  await runCommand(sandbox, `scrot --pointer ${path}`);
  try {
    const bytes = await sandbox.files.read(path, { format: "bytes" });
    if (!(bytes instanceof Uint8Array))
      throw new Error("the sandbox did not return the screenshot bytes");
    return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  } finally {
    await sandbox.files.remove?.(path).catch(() => undefined);
  }
}

/** The capture an action returns, or the note explaining its absence. */
async function captureDesktop(
  sandbox: E2BSandboxLike,
  suggestedName?: string
): Promise<{ capture?: DesktopCapture; warning?: string }> {
  try {
    const dataUri = await captureScreen(sandbox);
    return {
      capture: {
        dataUri,
        ...(suggestedName ? { suggestedName } : {}),
        attachable: dataUri.length <= MAX_ATTACHABLE_DATA_URI_CHARS,
      },
    };
  } catch (error) {
    // The action itself already happened; losing the capture must not turn
    // the whole call into a failure.
    console.warn(
      `[E2B] Desktop screenshot failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {
      warning:
        "The screenshot of the desktop could not be captured this time; the action itself did run.",
    };
  }
}

/** Applies one parsed action. `open` is handled by ensureChrome beforehand. */
async function performAction(sandbox: E2BSandboxLike, action: DesktopAction) {
  switch (action.kind) {
    case "open":
    case "capture":
    case "close":
    case "windows":
      return;
    case "launch":
      await runDetached(
        sandbox,
        `gtk-launch ${action.application}${
          action.url ? ` ${shellQuote(action.url)}` : ""
        }`
      );
      return;
    case "click": {
      if (action.x !== undefined && action.y !== undefined)
        await runCommand(sandbox, `xdotool mousemove --sync ${action.x} ${action.y}`);
      const button = action.button === "right" ? 3 : 1;
      const repeat = action.button === "double" ? " --repeat 2" : "";
      await runCommand(sandbox, `xdotool click${repeat} ${button}`);
      return;
    }
    case "move":
      await runCommand(sandbox, `xdotool mousemove --sync ${action.x} ${action.y}`);
      return;
    case "scroll": {
      const button = action.direction === "up" ? 4 : 5;
      await runCommand(sandbox, `xdotool click --repeat ${action.amount} ${button}`);
      return;
    }
    case "type":
      await runCommand(sandbox, `xdotool type --delay 40 -- ${shellQuote(action.text)}`);
      return;
    case "press":
      await runCommand(sandbox, `xdotool key ${shellQuote(action.keys)}`);
      return;
    case "wait":
      await runCommand(sandbox, `sleep ${(action.ms / 1000).toFixed(2)}`);
      return;
  }
}

function truncate(value: string) {
  const text = value.replace(/\u0000/g, "");
  return text.length <= BROWSE_OUTPUT_LIMIT
    ? text
    : `${text.slice(0, BROWSE_OUTPUT_LIMIT)}\n…(truncated)`;
}

/**
 * Connects to the workspace's desktop sandbox, or provisions one. A sandbox
 * whose session died (a pause that resumed without its display) is revived in
 * place first; only when that fails is the machine replaced, so a healthy
 * Chrome session is not thrown away over a hiccup.
 */
async function openDesktopSession(input: {
  client: E2BClientLike;
  workspaceId: number;
  ownerId: number;
  sandboxId?: string | null;
  onSandboxCreated?: (sandboxId: string) => Promise<void> | void;
}) {
  const { client, workspaceId, ownerId, sandboxId, onSandboxCreated } = input;
  if (sandboxId) {
    try {
      const existing = await client.connect(sandboxId, {
        timeoutMs: desktopSandboxTimeoutMs(),
      });
      if (await isDesktopReady(existing)) return { sandbox: existing, created: false };
      try {
        await startDesktopSession(existing);
        if (await isDesktopReady(existing)) return { sandbox: existing, created: false };
      } catch {
        // The revive failed: replace the machine below.
      }
      await existing.kill?.().catch(() => undefined);
    } catch (error) {
      // A sandbox that expired or was killed behind us is replaced, not fatal.
      console.warn(
        `[E2B] Desktop sandbox ${sandboxId} could not be reached: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  reserveSandboxCreation();
  const sandbox = await client.create(desktopSandboxConfig(workspaceId, ownerId));
  await onSandboxCreated?.(sandbox.sandboxId);
  await startDesktopSession(sandbox);
  return { sandbox, created: true };
}

/**
 * `close`: stop the Chrome app so its tabs cannot pile up between calls and
 * sit on the desktop machine's memory. It deliberately never boots, revives
 * or replaces a desktop - a machine that is not there has no tabs to close,
 * and waking one just to shut it down would be the opposite of the point. A
 * dead session is reported as closed for the same reason: its Chrome died
 * with it.
 */
async function closeBrowserSession(input: {
  client: E2BClientLike;
  sandboxId?: string | null;
}): Promise<DesktopBrowseOutcome> {
  if (!input.sandboxId)
    return {
      ok: true,
      result:
        "Closed every open browser tab: no desktop browser was running on this workspace, so there was nothing to close.",
    };

  let sandbox: E2BSandboxLike;
  try {
    sandbox = await input.client.connect(input.sandboxId, {
      timeoutMs: desktopSandboxTimeoutMs(),
    });
  } catch {
    // The machine expired or was killed behind us: its tabs went with it.
    return {
      ok: true,
      result:
        "Closed every open browser tab: the desktop machine is no longer running, so no tabs were left behind.",
    };
  }

  const stopped = await stopChrome(sandbox);
  if (!stopped)
    return {
      ok: false,
      result: [
        "Chrome did not stop in the desktop machine, so its tabs are still open.",
        "Run 'close' once more; if it keeps running, tell the user the desktop browser is not releasing its tabs instead of retrying forever.",
      ].join("\n\n"),
    };
  return {
    ok: true,
    result: [
      "Closed every open browser tab - the Chrome app is stopped, so no windows are held open between browse calls.",
      "The desktop machine and your logins are untouched: 'open <url>' starts Chrome again for the next page.",
    ].join("\n\n"),
  };
}

/**
 * Runs one browse command against the workspace's desktop GUI sandbox and
 * returns what happened plus the capture taken afterwards. Never throws: every
 * failure comes back as text the model can act on.
 */
export async function runDesktopBrowseCommand(input: {
  client: E2BClientLike;
  workspaceId: number;
  ownerId: number;
  command: string;
  /** The desktop sandbox already provisioned for this workspace, if any. */
  sandboxId?: string | null;
  /** Records a freshly provisioned desktop sandbox id for later calls. */
  onSandboxCreated?: (sandboxId: string) => Promise<void> | void;
}): Promise<DesktopBrowseOutcome> {
  const action = parseDesktopCommand(input.command);
  if ("error" in action) return { ok: false, result: action.error };

  try {
    // `close` answers for itself: it needs no Chrome launch, no revive and no
    // capture, only a machine to stop Chrome on when there is one.
    if (action.kind === "close") return closeBrowserSession(input);
    const session = await openDesktopSession(input);
    const sandbox = session.sandbox;
    // Chrome first: the Chrome app on screen is what makes the capture a
    // browser screenshot rather than a picture of an empty desktop. Its
    // failure only fails an explicit `open` - the other commands still
    // answer with whatever the screen is showing.
    const url = action.kind === "open" ? action.url : undefined;
    const chromeUp = await ensureChrome(sandbox, url);
    await performAction(sandbox, action);

    const lines = [`${action.summary} (screen ${SCREEN_WIDTH}x${SCREEN_HEIGHT}).`];
    if (session.created)
      lines.push(
        "This was the workspace's first browse call, so the desktop machine started fresh; later calls reuse this session and are faster."
      );

    if (action.kind === "windows") {
      const windows = await listWindows(sandbox);
      lines.push(
        windows ? `Visible windows:\n${truncate(windows)}` : "No visible windows are open."
      );
      return { ok: true, result: lines.join("\n\n") };
    }

    const { capture, warning } = await captureDesktop(
      sandbox,
      action.kind === "capture" ? action.name : undefined
    );
    const withCapture = capture ? { screenshot: capture } : {};

    if (!chromeUp) {
      const advice = [
        url
          ? `Chrome did not open ${url} in the desktop sandbox.`
          : "Chrome is not running in the desktop sandbox.",
        "The desktop machine is up, but no Chrome window appeared. Try the command once more - a cold start occasionally needs a second attempt - and if it keeps failing, tell the user the desktop browser could not start instead of retrying forever.",
      ];
      if (warning) advice.push(warning);
      return { ok: false, result: advice.join("\n\n"), ...withCapture };
    }

    const title = await activeWindowTitle(sandbox);
    if (title) lines.push(`The focused window is "${title}".`);
    if (warning) lines.push(warning);

    return { ok: true, result: lines.join("\n\n"), ...withCapture };
  } catch (error) {
    const message = truncate(
      error instanceof Error ? error.message : String(error ?? "")
    );
    return {
      ok: false,
      result: [
        `The desktop command could not run: ${message || "unknown sandbox error"}.`,
        "The workspace's desktop sandbox may have timed out or failed to boot. Try the command once more, and if it fails again, tell the user the desktop browser is unavailable right now.",
      ].join("\n\n"),
    };
  }
}
