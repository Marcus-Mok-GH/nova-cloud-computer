import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runNimAgentChatMock = vi.hoisted(() => vi.fn());
const sandboxCommandsRun = vi.fn();
const sandboxFilesWrite = vi.fn();
const sandboxFilesRead = vi.fn();

vi.mock("./nim", () => ({
  NimContextLengthError: class extends Error {},
  runNimAgentChat: runNimAgentChatMock,
}));

vi.mock("./_core/env", () => ({
  ENV: {
    nimCoderModel: "test/model",
    nimCoderApiUrl: "https://test.example/v1",
    nimCoderApiKey: "test-key",
  },
}));

vi.mock("./sandboxWorkspace", () => ({
  mirrorWorkspaceOp: vi.fn(async (_sandbox, op: { kind: string; path: string }) => {
    if (op.kind === "write_file") {
      sandboxFilesWrite(op.path, op.content);
      return { ok: true };
    }
    return { ok: false, error: "not mocked" };
  }),
  syncAgentSandbox: vi.fn(async () => 0),
}));

import {
  AGENTS_INIT_PROMPT_BASE,
  PREPARING_NEXT_TURN_ACTIVITY,
  launchPreparingNextTurn,
  runAgentsInitTask,
} from "./agentsInit";
import { syncAgentSandbox } from "./sandboxWorkspace";

const sandbox = {
  commands: { run: sandboxCommandsRun },
  files: { read: sandboxFilesRead, write: sandboxFilesWrite },
};

const events: Array<Record<string, unknown>> = [];
const onEvent = (event: { type: string; tool: unknown }) => {
  events.push(event as Record<string, unknown>);
};

beforeEach(() => {
  runNimAgentChatMock.mockReset();
  sandboxCommandsRun.mockReset();
  sandboxFilesWrite.mockClear();
  sandboxFilesRead.mockReset();
  vi.mocked(syncAgentSandbox).mockClear();
  events.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AGENTS_INIT_PROMPT_BASE", () => {
  it("is opencode's /init prompt rebranded to Nova, all else intact", () => {
    expect(AGENTS_INIT_PROMPT_BASE).toContain("helps future Nova sessions avoid mistakes");
    expect(AGENTS_INIT_PROMPT_BASE).not.toContain("opencode");
    expect(AGENTS_INIT_PROMPT_BASE).toContain("## How to investigate");
    expect(AGENTS_INIT_PROMPT_BASE).toContain("$ARGUMENTS");
    expect(AGENTS_INIT_PROMPT_BASE).toContain("repo-local Nova config");
  });
});

describe("runAgentsInitTask", () => {
  it("lists the workspace and writes AGENTS.md from the write_file call", async () => {
    sandboxCommandsRun.mockResolvedValue({ stdout: "README.md\nsrc/main.py\n", exitCode: 0 });
    runNimAgentChatMock
      .mockResolvedValueOnce({
        kind: "tool_calls",
        text: "",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: JSON.stringify({ path: "README.md" }) },
        ],
      })
      .mockResolvedValueOnce({
        kind: "tool_calls",
        text: "",
        toolCalls: [
          { id: "c2", name: "write_file", arguments: JSON.stringify({ path: "AGENTS.md", content: "# AGENTS.md" }) },
        ],
      })
      .mockResolvedValueOnce({ kind: "text", text: "Wrote AGENTS.md." });
    sandboxFilesRead.mockResolvedValue("readme text");

    const result = await runAgentsInitTask({
      sandbox,
      deadlineAtMs: Date.now() + 60_000,
    });

    expect(result.wroteAgentsMd).toBe(true);
    expect(result.summary).toBe("Wrote AGENTS.md.");
    // write_file mirrors onto the durable workspace store.
    expect(sandboxFilesWrite).toHaveBeenCalledWith("AGENTS.md", "# AGENTS.md");
    // The intro carries the workspace listing.
    const intro = runNimAgentChatMock.mock.calls[0][0].messages[1].content;
    expect(intro).toContain("README.md");
    expect(intro).toContain(AGENTS_INIT_PROMPT_BASE.slice(0, 80));
  });

  it("refuses shell file mutations like the editor does", async () => {
    sandboxCommandsRun.mockResolvedValue({ stdout: "", exitCode: 0 });
    runNimAgentChatMock
      .mockResolvedValueOnce({
        kind: "tool_calls",
        text: "",
        toolCalls: [
          { id: "c1", name: "run_command", arguments: JSON.stringify({ command: "rm AGENTS.md" }) },
        ],
      })
      .mockResolvedValueOnce({ kind: "text", text: "done" });

    await runAgentsInitTask({ sandbox, deadlineAtMs: Date.now() + 60_000 });

    const toolResult = runNimAgentChatMock.mock.calls[1][0].messages.find(
      (m: { role: string }) => m.role === "tool"
    );
    expect(toolResult.content).toContain("Rejected");
  });

  it("returns an honest no-start summary when the budget is already gone", async () => {
    const result = await runAgentsInitTask({
      sandbox,
      deadlineAtMs: Date.now() - 1_000,
    });
    expect(result.wroteAgentsMd).toBe(false);
    expect(result.summary).toContain("could not start");
    expect(runNimAgentChatMock).not.toHaveBeenCalled();
  });
});

describe("launchPreparingNextTurn", () => {
  function activity(name: string) {
    return events.find(
      event =>
        (event.tool as { name?: string }).name === name
    ) as { tool: Record<string, unknown> } | undefined;
  }
  function lastActivity(name: string) {
    const matching = events.filter(
      event => (event.tool as { name?: string }).name === name
    );
    return matching[matching.length - 1] as
      | { tool: Record<string, unknown> }
      | undefined;
  }

  it("emits running then completed and syncs the sandbox", async () => {
    sandboxCommandsRun.mockResolvedValue({ stdout: "README.md\n", exitCode: 0 });
    runNimAgentChatMock
      .mockResolvedValueOnce({
        kind: "tool_calls",
        text: "",
        toolCalls: [
          { id: "c1", name: "write_file", arguments: JSON.stringify({ path: "AGENTS.md", content: "# AGENTS.md" }) },
        ],
      })
      .mockResolvedValueOnce({ kind: "text", text: "AGENTS.md refreshed." });

    await launchPreparingNextTurn({
      ownerId: 1,
      chatId: "chat",
      sandbox,
      workspaceId: 41,
      onEvent,
    });

    const running = activity(PREPARING_NEXT_TURN_ACTIVITY);
    expect(running?.tool.state).toBe("running");
    const completed = lastActivity(PREPARING_NEXT_TURN_ACTIVITY);
    expect(completed?.tool.state).toBe("completed");
    expect(syncAgentSandbox).toHaveBeenCalledWith(1, 41, sandbox);
  });

  it("settles the activity to failed and never throws", async () => {
    sandboxCommandsRun.mockResolvedValue({ stdout: "", exitCode: 0 });
    runNimAgentChatMock.mockRejectedValue(new Error("model unavailable"));

    await expect(
      launchPreparingNextTurn({
        ownerId: 1,
        chatId: "chat",
        sandbox,
        workspaceId: 41,
        onEvent,
      })
    ).resolves.toBeUndefined();

    const last = lastActivity(PREPARING_NEXT_TURN_ACTIVITY);
    expect(last?.tool.state).toBe("failed");
  });

  it("settles to failed when no sandbox is available", async () => {
    await launchPreparingNextTurn({
      ownerId: 1,
      chatId: "chat",
      sandbox: undefined,
      workspaceId: undefined,
      onEvent,
    });

    const last = lastActivity(PREPARING_NEXT_TURN_ACTIVITY);
    expect(last?.tool.state).toBe("failed");
    expect(last?.tool.summary).toContain("sandbox");
    expect(runNimAgentChatMock).not.toHaveBeenCalled();
    expect(syncAgentSandbox).not.toHaveBeenCalled();
  });
});
