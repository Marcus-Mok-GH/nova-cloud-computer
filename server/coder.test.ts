import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAutonomousCoderTask, runCoderTask } from "./coder";

const state = vi.hoisted(() => ({ nimModel: "moonshotai/kimi-k3" }));
vi.mock("./_core/env", () => ({
  ENV: { get nimCoderModel() { return state.nimModel; } },
}));

const runNimChatMock = vi.hoisted(() => vi.fn());
const runNimAgentChatMock = vi.hoisted(() => vi.fn());
vi.mock("./nim", () => {
  class NimToolsUnsupportedError extends Error {}
  class NimConfigError extends Error {}
  return {
    runNimChat: runNimChatMock,
    runNimAgentChat: runNimAgentChatMock,
    NimToolsUnsupportedError,
    NimConfigError,
  };
});

const { NimToolsUnsupportedError } = await import("./nim");

beforeEach(() => {
  runNimChatMock.mockReset();
  runNimAgentChatMock.mockReset();
  state.nimModel = "moonshotai/kimi-k3";
});

describe("runCoderTask", () => {
  it("assembles the language, task and context into one specialist prompt", async () => {
    runNimChatMock.mockResolvedValueOnce("```python\nprint('hi')\n```");

    const result = await runCoderTask(
      "write a hello world",
      "the file must be plain Python 3",
      "Python"
    );

    expect(result.code).toBe("```python\nprint('hi')\n```");
    expect(result.model).toBe("moonshotai/kimi-k3");
    const [options] = runNimChatMock.mock.calls[0];
    expect(options.systemPrompt).toContain("Nova's coding specialist");
    expect(options.prompt).toBe(
      [
        "Target language/framework: Python",
        "Coding task:\n\nwrite a hello world",
        "Existing code, errors, and other context:\n\nthe file must be plain Python 3",
      ].join("\n\n")
    );
  });

  it("omits the optional language and context lines when not provided", async () => {
    runNimChatMock.mockResolvedValueOnce("code");
    await runCoderTask("fix the bug");
    expect(runNimChatMock.mock.calls[0][0].prompt).toBe("Coding task:\n\nfix the bug");
  });

  it("rejects an empty task before calling the model", async () => {
    await expect(runCoderTask("   ")).rejects.toThrow("A coding task is required.");
    expect(runNimChatMock).not.toHaveBeenCalled();
  });

  it("propagates configuration errors verbatim, including the operator hint", async () => {
    runNimChatMock.mockRejectedValueOnce(
      new Error("NVIDIA NIM is not configured - set NVIDIA_NIM_API_KEY (or the legacy NVIDIA_API_KEY) to enable it.")
    );
    await expect(runCoderTask("write tests")).rejects.toThrow(
      "NVIDIA NIM is not configured - set NVIDIA_NIM_API_KEY (or the legacy NVIDIA_API_KEY) to enable it."
    );
  });
});

// A fake sandbox the autonomous specialist can work in.
const fakeSandbox = () => {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    sandboxId: "sbx-coder",
    files: {
      write: vi.fn(async (path: string, data: unknown) =>
        writes.push({ path, content: String(data) })
      ),
      read: vi.fn(async () => "<html>old</html>"),
      list: vi.fn(async () => []),
    },
    commands: {
      run: vi.fn(async (command: string) => ({
        exitCode: 0,
        stdout: command.includes("find") ? "./index.html\nwelcome.md\n" : "all good",
        stderr: "",
      })),
    },
  };
};

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  kind: "tool_calls" as const,
  text: "",
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});
const textReply = (text: string) => ({ kind: "text" as const, text });

describe("runAutonomousCoderTask", () => {
  it("explores, writes and verifies on its own, then reports a summary", async () => {
    const sandbox = fakeSandbox();
    const progress: string[] = [];
    runNimAgentChatMock
      .mockResolvedValueOnce(toolCall("c1", "list_files", {}))
      .mockResolvedValueOnce(toolCall("c2", "write_file", { path: "index.html", content: "<html>game</html>" }))
      .mockResolvedValueOnce(toolCall("c3", "run_command", { command: "python3 -m http.server --check" }))
      .mockResolvedValueOnce(textReply("Built the game and verified it runs."));

    const outcome = await runAutonomousCoderTask({
      task: "build a game",
      language: "HTML",
      sandbox: sandbox as never,
      onProgress: note => progress.push(note),
    });

    expect(outcome).toEqual({
      kind: "autonomous",
      summary: "Built the game and verified it runs.",
      writtenPaths: ["index.html"],
      commandsRun: 1,
      rounds: 4,
      model: "moonshotai/kimi-k3",
    });
    // The write landed in the sandbox at the workspace path.
    expect(sandbox.writes).toEqual([
      { path: "/home/user/workspace/index.html", content: "<html>game</html>" },
    ]);
    // The command ran inside the workspace directory.
    const command = sandbox.commands.run.mock.calls.find(
      args => String(args[0]).includes("http.server")
    );
    expect(String(command?.[0])).toContain("cd /home/user/workspace &&");
    // The loop fed each tool result back under its tool call id, with the
    // full conversation preserved round over round.
    const lastCallMessages = runNimAgentChatMock.mock.calls[3][0].messages;
    const toolResults = lastCallMessages.filter(m => m.role === "tool");
    expect(toolResults.map(m => m.tool_call_id)).toEqual(["c1", "c2", "c3"]);
    expect(toolResults[0].content).toContain("index.html");
    expect(toolResults[1].content).toContain("Wrote index.html");
    expect(toolResults[2].content).toContain("[exit code 0]");
    // The very first prompt carried the task and the workspace listing.
    const firstCallMessages = runNimAgentChatMock.mock.calls[0][0].messages;
    expect(firstCallMessages[1].content).toContain("Coding task:\n\nbuild a game");
    // The user-facing progress notes narrated the specialist's steps.
    expect(progress).toEqual(
      expect.arrayContaining([
        "The specialist is listing the workspace files…",
        "The specialist wrote index.html…",
      ])
    );
  });

  it("falls back to the single-shot reply when the model rejects tools", async () => {
    runNimAgentChatMock.mockRejectedValueOnce(
      new NimToolsUnsupportedError("NVIDIA NIM responded with status 400: tools unsupported.")
    );
    runNimChatMock.mockResolvedValueOnce("def solve(): pass");

    const outcome = await runAutonomousCoderTask({
      task: "write a solver",
      sandbox: fakeSandbox() as never,
    });

    expect(outcome).toEqual({ kind: "single", code: "def solve(): pass", model: "moonshotai/kimi-k3" });
  });

  it("stops at the round cap and reports exactly what was done", async () => {
    let calls = 0;
    runNimAgentChatMock.mockImplementation(async () => {
      calls += 1;
      return toolCall(`c${calls}`, "list_files", {});
    });

    const outcome = await runAutonomousCoderTask({
      task: "an endless task",
      sandbox: fakeSandbox() as never,
    });

    expect(calls).toBe(12);
    if (outcome.kind !== "autonomous") throw new Error("expected autonomous outcome");
    expect(outcome.summary).toContain("ran out of steps");
    expect(outcome.writtenPaths).toEqual([]);
  });

  it("rejects unsafe write paths without touching the sandbox", async () => {
    const sandbox = fakeSandbox();
    runNimAgentChatMock
      .mockResolvedValueOnce(
        toolCall("c1", "write_file", { path: "../outside.txt", content: "nope" })
      )
      .mockResolvedValueOnce(textReply("Nothing to do."));

    await runAutonomousCoderTask({ task: "do something", sandbox: sandbox as never });

    expect(sandbox.writes).toEqual([]);
    const toolResult = runNimAgentChatMock.mock.calls[1][0].messages.find(
      m => m.role === "tool"
    );
    expect(toolResult.content).toContain("Unsafe path: ../outside.txt");
  });

  it("refuses an empty task before calling the model", async () => {
    await expect(
      runAutonomousCoderTask({ task: "  ", sandbox: fakeSandbox() as never })
    ).rejects.toThrow("A coding task is required.");
    expect(runNimAgentChatMock).not.toHaveBeenCalled();
  });
});
