import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceComputer: vi.fn(),
  updateWorkspacePersistentSandbox: vi.fn(),
  getE2BClient: vi.fn(),
  ensurePersistentSandbox: vi.fn(),
  withE2BWorkspaceLock: vi.fn(),
  commandRun: vi.fn(),
}));

vi.mock("./db", () => ({
  getWorkspaceComputer: mocks.getWorkspaceComputer,
  updateWorkspacePersistentSandbox: mocks.updateWorkspacePersistentSandbox,
}));
vi.mock("./e2b", () => ({
  ensurePersistentSandbox: mocks.ensurePersistentSandbox,
  getE2BClient: mocks.getE2BClient,
  withE2BWorkspaceLock: mocks.withE2BWorkspaceLock,
}));

const {
  disconnectOpenAICodex,
  getOpenAICodexConnectionStatus,
  startOpenAICodexDeviceLogin,
} = await import("./codexConnector");

const client = { provider: "e2b" };
const sandbox = {
  sandboxId: "private-sandbox",
  commands: { run: mocks.commandRun },
} as never;

function commandResult(stdout: string) {
  return { exitCode: 0, stdout, stderr: "" };
}

describe("OpenAI Codex E2B connector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getE2BClient.mockReturnValue(client);
    mocks.getWorkspaceComputer.mockImplementation(async (ownerId: number) => ({
      workspace: {
        id: ownerId * 10,
        persistentSandboxId: `sandbox-${ownerId}`,
      },
    }));
    mocks.ensurePersistentSandbox.mockResolvedValue(sandbox);
    mocks.withE2BWorkspaceLock.mockImplementation(
      async (
        _ownerId: number,
        _workspaceId: number,
        operation: () => Promise<unknown>
      ) => operation()
    );
  });

  it("reads the device code from the requesting user's private VM", async () => {
    mocks.commandRun.mockResolvedValue(
      commandResult(
        JSON.stringify({
          connected: false,
          pending: true,
          state: "pending",
          userCode: "ABCD-EFGH",
        })
      )
    );

    await expect(getOpenAICodexConnectionStatus(17)).resolves.toEqual({
      configured: true,
      connected: false,
      pending: true,
      state: "pending",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
    });
    expect(mocks.getWorkspaceComputer).toHaveBeenCalledWith(17);
    expect(mocks.ensurePersistentSandbox).toHaveBeenCalledWith(
      client,
      170,
      17,
      "sandbox-17"
    );
  });

  it("starts the official device login inside the user's VM", async () => {
    let statusCalls = 0;
    mocks.commandRun.mockImplementation(async (command: string) => {
      if (command.includes("old_value")) return commandResult("started");
      statusCalls += 1;
      return commandResult(
        JSON.stringify(
          statusCalls === 1
            ? {
                connected: false,
                pending: false,
                state: "disconnected",
                userCode: null,
              }
            : {
                connected: false,
                pending: true,
                state: "pending",
                userCode: "ABCD-EFGH",
              }
        )
      );
    });

    await expect(startOpenAICodexDeviceLogin(9)).resolves.toMatchObject({
      pending: true,
      userCode: "ABCD-EFGH",
    });
    const scripts = mocks.commandRun.mock.calls.map(([command]) =>
      String(command)
    );
    expect(scripts.join("\n")).toContain("codex login --device-auth");
    expect(scripts.join("\n")).toContain('env["CODEX_HOME"] = str(codex_home)');
    expect(mocks.ensurePersistentSandbox).toHaveBeenCalledWith(
      client,
      90,
      9,
      "sandbox-9"
    );
  });

  it("clears credentials and pending login state from only the user's VM", async () => {
    mocks.commandRun.mockImplementation(async (command: string) =>
      command.includes("for name in")
        ? commandResult("disconnected")
        : commandResult(
            JSON.stringify({
              connected: false,
              pending: false,
              state: "disconnected",
              userCode: null,
            })
          )
    );

    await expect(disconnectOpenAICodex(4)).resolves.toMatchObject({
      connected: false,
      pending: false,
      state: "disconnected",
    });
    const cleanupScript = String(mocks.commandRun.mock.calls[0]?.[0]);
    expect(cleanupScript).toContain('"auth.json"');
    expect(mocks.getWorkspaceComputer).toHaveBeenCalledWith(4);
    expect(mocks.ensurePersistentSandbox).toHaveBeenCalledWith(
      client,
      40,
      4,
      "sandbox-4"
    );
  });
});
