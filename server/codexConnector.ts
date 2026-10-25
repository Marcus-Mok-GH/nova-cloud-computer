import { getWorkspaceComputer, updateWorkspacePersistentSandbox } from "./db";
import {
  ensurePersistentSandbox,
  getE2BClient,
  withE2BWorkspaceLock,
  type E2BSandboxLike,
} from "./e2b";

const VERIFY_URL = "https://auth.openai.com/codex/device";
const DEVICE_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;

export type OpenAICodexConnectionStatus = {
  configured: boolean;
  connected: boolean;
  pending: boolean;
  state:
    | "not_configured"
    | "disconnected"
    | "starting"
    | "pending"
    | "connected"
    | "error";
  verificationUrl: string | null;
  userCode: string | null;
};

export class OpenAICodexConnectorError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "OpenAICodexConnectorError";
  }
}

const UNCONFIGURED: OpenAICodexConnectionStatus = {
  configured: false,
  connected: false,
  pending: false,
  state: "not_configured",
  verificationUrl: null,
  userCode: null,
};

/** Run trusted, static Python helpers inside the account's persistent E2B VM. */
async function runSandboxPython(sandbox: E2BSandboxLike, source: string) {
  const result = await sandbox.commands.run(`python3 - <<'PY'\n${source}\nPY`, {
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0)
    throw new OpenAICodexConnectorError(
      "Nova could not access the Codex connection on your private computer.",
      502
    );
  return result.stdout.trim();
}

async function withOwnerSandbox<T>(
  ownerId: number,
  operation: (sandbox: E2BSandboxLike) => Promise<T>
): Promise<T> {
  const client = getE2BClient();
  if (!client)
    throw new OpenAICodexConnectorError(
      "The private workspace computer is not configured yet.",
      503
    );

  const computer = await getWorkspaceComputer(ownerId);
  return withE2BWorkspaceLock(ownerId, computer.workspace.id, async () => {
    const sandbox = await ensurePersistentSandbox(
      client,
      computer.workspace.id,
      ownerId,
      computer.workspace.persistentSandboxId
    );
    if (!computer.workspace.persistentSandboxId)
      await updateWorkspacePersistentSandbox(
        computer.workspace.id,
        sandbox.sandboxId
      );
    return operation(sandbox);
  });
}

const READ_STATUS_SCRIPT = String.raw`
import json, os, pathlib, re, time

home = pathlib.Path.home()
codex_home = home / ".codex"
auth_path = codex_home / "auth.json"
pid_path = codex_home / ".nova-device-auth.pid"
log_path = codex_home / ".nova-device-auth.log"
failed_path = codex_home / ".nova-device-auth.failed"

connected = False
try:
    auth = json.loads(auth_path.read_text())
    connected = bool((auth.get("tokens") or {}).get("access_token"))
except (OSError, ValueError, TypeError):
    pass

pid = None
starting = False
try:
    pid_value = pid_path.read_text().strip()
    if pid_value.startswith("starting:"):
        started_at = float(pid_value.split(":", 1)[1])
        starting = time.time() - started_at < 60
        if not starting:
            pid_path.unlink(missing_ok=True)
    else:
        pid = int(pid_value)
        os.kill(pid, 0)
        try:
            command = pathlib.Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace")
            if "nova-device-auth-runner.py" not in command.lower() and "codex" not in command.lower() and "npx" not in command.lower():
                pid = None
                pid_path.unlink(missing_ok=True)
                log_path.unlink(missing_ok=True)
        except OSError:
            pass
except (OSError, ValueError):
    pid = None
    pid_path.unlink(missing_ok=True)
    log_path.unlink(missing_ok=True)

code = None
if pid:
    try:
        log = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", log_path.read_text(errors="replace"))
        prompt = re.search(r"Enter this one-time code[^\n]*\n\s*([A-Z0-9]{4}-[A-Z0-9]{4})", log, re.IGNORECASE)
        if prompt:
            code = prompt.group(1).upper()
    except OSError:
        pass

pending = bool(pid) or starting
state = "connected" if connected else ("pending" if pid and code else "starting" if pending else "error" if failed_path.exists() else "disconnected")
print(json.dumps({"connected": connected, "pending": pending, "state": state, "userCode": code if pid and not connected else None}))
`;

async function readStatus(
  sandbox: E2BSandboxLike
): Promise<OpenAICodexConnectionStatus> {
  const raw = await runSandboxPython(sandbox, READ_STATUS_SCRIPT);
  let result: {
    connected?: boolean;
    pending?: boolean;
    state?: string;
    userCode?: string | null;
  };
  try {
    result = JSON.parse(raw);
  } catch {
    throw new OpenAICodexConnectorError(
      "Nova could not read the Codex connection status.",
      502
    );
  }

  const connected = result.connected === true;
  const pending = !connected && result.pending === true;
  const state = connected
    ? "connected"
    : pending
      ? result.userCode
        ? "pending"
        : "starting"
      : result.state === "error"
        ? "error"
        : "disconnected";
  const userCode =
    pending &&
    state === "pending" &&
    typeof result.userCode === "string" &&
    DEVICE_CODE_PATTERN.test(result.userCode)
      ? result.userCode
      : null;

  return {
    configured: true,
    connected,
    pending,
    state,
    verificationUrl: userCode ? VERIFY_URL : null,
    userCode,
  };
}

/** Reports status without ever returning or storing the user's OAuth tokens. */
export async function getOpenAICodexConnectionStatus(ownerId: number) {
  if (!getE2BClient()) return UNCONFIGURED;
  return withOwnerSandbox(ownerId, readStatus);
}

const DEVICE_AUTH_RUNNER_SCRIPT = String.raw`
import os, pathlib, pty, subprocess

home = pathlib.Path.home()
codex_home = home / ".codex"
log_path = codex_home / ".nova-device-auth.log"
pid_path = codex_home / ".nova-device-auth.pid"
failed_path = codex_home / ".nova-device-auth.failed"
runner_path = codex_home / ".nova-device-auth-runner.py"
env = os.environ.copy()
env["CODEX_HOME"] = str(codex_home)
master_fd, slave_fd = pty.openpty()
exit_code = 1
try:
    process = subprocess.Popen(
        ["npx", "--yes", "--package", "@openai/codex@latest", "codex", "login", "--device-auth"],
        cwd=str(home),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
    )
    os.close(slave_fd)
    slave_fd = -1
    with os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as log:
        while True:
            try:
                data = os.read(master_fd, 4096)
            except OSError:
                break
            if not data:
                break
            log.write(data)
            log.flush()
    exit_code = process.wait()
except OSError:
    exit_code = 127
finally:
    os.close(master_fd)
    if slave_fd >= 0:
        os.close(slave_fd)
    if exit_code == 0:
        log_path.unlink(missing_ok=True)
        failed_path.unlink(missing_ok=True)
    else:
        log_path.unlink(missing_ok=True)
        failed_path.touch(mode=0o600, exist_ok=True)
    pid_path.unlink(missing_ok=True)
    runner_path.unlink(missing_ok=True)
`;

const DEVICE_AUTH_RUNNER_BASE64 = Buffer.from(
  DEVICE_AUTH_RUNNER_SCRIPT,
  "utf8"
).toString("base64");

const START_LOGIN_SCRIPT = String.raw`
import os, pathlib, subprocess, time

home = pathlib.Path.home()
codex_home = home / ".codex"
codex_home.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(codex_home, 0o700)
auth_path = codex_home / "auth.json"
pid_path = codex_home / ".nova-device-auth.pid"
log_path = codex_home / ".nova-device-auth.log"
failed_path = codex_home / ".nova-device-auth.failed"

try:
    auth = __import__("json").loads(auth_path.read_text())
    if (auth.get("tokens") or {}).get("access_token"):
        print("connected")
        raise SystemExit(0)
except (OSError, ValueError, TypeError):
    pass

try:
    old_value = pid_path.read_text().strip()
    if old_value.startswith("starting:"):
        if time.time() - float(old_value.split(":", 1)[1]) < 60:
            print("pending")
            raise SystemExit(0)
    else:
        old_pid = int(old_value)
        os.kill(old_pid, 0)
        command = pathlib.Path(f"/proc/{old_pid}/cmdline").read_bytes().decode(errors="replace")
        if "nova-device-auth-runner.py" in command.lower() or "codex" in command.lower() or "npx" in command.lower():
            print("pending")
            raise SystemExit(0)
except (OSError, ValueError):
    pass
try:
    pid_path.unlink()
except FileNotFoundError:
    pass

try:
    reservation = os.open(pid_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
except FileExistsError:
    print("pending")
    raise SystemExit(0)
with os.fdopen(reservation, "w") as marker:
    marker.write("starting:" + str(time.time()))

failed_path.unlink(missing_ok=True)
env = os.environ.copy()
env["CODEX_HOME"] = str(codex_home)
for variable in ("OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"):
    env.pop(variable, None)
# The runner executes codex login --device-auth via npx and uses a PTY so its one-time code is flushed immediately.
runner_path = codex_home / ".nova-device-auth-runner.py"
runner_path.write_bytes(__import__("base64").b64decode("${DEVICE_AUTH_RUNNER_BASE64}"))
os.chmod(runner_path, 0o600)
process = subprocess.Popen(
    ["python3", str(runner_path)],
    cwd=str(home),
    env=env,
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
    close_fds=True,
)
pid_path.write_text(str(process.pid))
os.chmod(pid_path, 0o600)
if process.poll() is not None:
    pid_path.unlink(missing_ok=True)
print("started")
`;

/** Starts the official Codex CLI device-code login in the user's own VM. */
export async function startOpenAICodexDeviceLogin(ownerId: number) {
  return withOwnerSandbox(ownerId, async sandbox => {
    const current = await readStatus(sandbox);
    if (current.connected || current.pending) return current;

    await runSandboxPython(sandbox, START_LOGIN_SCRIPT);
    return readStatus(sandbox);
  });
}

const DISCONNECT_SCRIPT = String.raw`
import os, pathlib, signal, time

codex_home = pathlib.Path.home() / ".codex"
pid_path = codex_home / ".nova-device-auth.pid"
try:
    pid = int(pid_path.read_text().strip())
    os.killpg(pid, signal.SIGTERM)
    time.sleep(0.15)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
except (OSError, ValueError):
    pass

for name in ("auth.json", ".nova-device-auth.pid", ".nova-device-auth.log", ".nova-device-auth.failed", ".nova-device-auth-runner.py"):
    try:
        (codex_home / name).unlink()
    except FileNotFoundError:
        pass
print("disconnected")
`;

/** Deletes the Codex credentials and any in-progress device login from this user's VM. */
export async function disconnectOpenAICodex(ownerId: number) {
  if (!getE2BClient()) return UNCONFIGURED;
  return withOwnerSandbox(ownerId, async sandbox => {
    await runSandboxPython(sandbox, DISCONNECT_SCRIPT);
    return readStatus(sandbox);
  });
}
