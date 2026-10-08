import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAutonomousCoderTask, runCoderTask } from "./coder";

const state = vi.hoisted(() => ({
  nimModel: "deepseek/deepseek-v4.1-flash",
  nimUrl: "https://gen.pollinations.ai/v1",
  nimKey: "sk-poll",
}));
vi.mock("./_core/env", () => ({
  ENV: {
    get nimCoderModel() {
      return state.nimModel;
    },
    get nimCoderApiUrl() {
      return state.nimUrl;
    },
    get nimCoderApiKey() {
      return state.nimKey;
    },
  },
}));

const runNimChatMock = vi.hoisted(() => vi.fn());
const runNimAgentChatMock = vi.hoisted(() => vi.fn());
vi.mock("./nim", () => {
  class NimToolsUnsupportedError extends Error {}
  class NimContextLengthError extends Error {}
  class NimConfigError extends Error {}
  return {
    runNimChat: runNimChatMock,
    runNimAgentChat: runNimAgentChatMock,
    NimToolsUnsupportedError,
    NimContextLengthError,
    NimConfigError,
  };
});

const { NimToolsUnsupportedError, NimContextLengthError } = await import(
  "./nim"
);

beforeEach(() => {
  runNimChatMock.mockReset();
  runNimAgentChatMock.mockReset();
  state.nimModel = "deepseek/deepseek-v4.1-flash";
  state.nimUrl = "https://gen.pollinations.ai/v1";
  state.nimKey = "sk-poll";
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
    expect(result.model).toBe("deepseek/deepseek-v4.1-flash");
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

  it("runs on the editor's own endpoint and key, not the shared NIM configuration", async () => {
    runNimChatMock.mockResolvedValueOnce("code");
    await runCoderTask("fix it");
    const [options] = runNimChatMock.mock.calls[0];
    expect(options.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(options.apiUrl).toBe("https://gen.pollinations.ai/v1");
    expect(options.apiKey).toBe("sk-poll");
  });

  it("hands the model request the caller's full deadline", async () => {
    runNimChatMock.mockResolvedValueOnce("code");
    const deadline = Date.now() + 200_000;
    await runCoderTask("fix it", undefined, undefined, deadline);
    expect(runNimChatMock.mock.calls[0][0].deadlineAtMs).toBe(deadline);
  });

  it("omits the model deadline when the caller gives none", async () => {
    runNimChatMock.mockResolvedValueOnce("code");
    await runCoderTask("fix it");
    expect(runNimChatMock.mock.calls[0][0]).not.toHaveProperty("deadlineAtMs");
  });

  it("omits the optional language and context lines when not provided", async () => {
    runNimChatMock.mockResolvedValueOnce("code");
    await runCoderTask("fix the bug");
    expect(runNimChatMock.mock.calls[0][0].prompt).toBe(
      "Coding task:\n\nfix the bug"
    );
  });

  it("rejects an empty task before calling the model", async () => {
    await expect(runCoderTask("   ")).rejects.toThrow(
      "A coding task is required."
    );
    expect(runNimChatMock).not.toHaveBeenCalled();
  });

  it("propagates configuration errors verbatim", async () => {
    runNimChatMock.mockRejectedValueOnce(
      new Error(
        "The coding specialist is not configured on this workspace - the workspace owner must finish setting it up."
      )
    );
    await expect(runCoderTask("write tests")).rejects.toThrow(
      "The coding specialist is not configured on this workspace - the workspace owner must finish setting it up."
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
        stdout: command.includes("find")
          ? "./index.html\nwelcome.md\n"
          : "all good",
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
    const activities: Array<{
      id: string;
      name: string;
      state: string;
      args: Record<string, string>;
      summary?: string;
    }> = [];
    runNimAgentChatMock
      .mockResolvedValueOnce(toolCall("c1", "list_files", {}))
      .mockResolvedValueOnce(
        toolCall("c2", "write_file", {
          path: "index.html",
          content: "<html>game</html>",
        })
      )
      .mockResolvedValueOnce(
        toolCall("c3", "run_command", {
          command: "python3 -m http.server --check",
        })
      )
      .mockResolvedValueOnce(textReply("Built the game and verified it runs."));

    const outcome = await runAutonomousCoderTask({
      task: "build a game",
      language: "HTML",
      sandbox: sandbox as never,
      onProgress: note => progress.push(note),
      onToolActivity: activity => {
        activities.push(activity);
      },
    });

    expect(outcome).toEqual({
      kind: "autonomous",
      summary: "Built the game and verified it runs.",
      writtenPaths: ["index.html"],
      commandsRun: 1,
      rounds: 4,
      model: "deepseek/deepseek-v4.1-flash",
    });
    // The write landed in the sandbox at the workspace path.
    expect(sandbox.writes).toEqual([
      { path: "/home/user/workspace/index.html", content: "<html>game</html>" },
    ]);
    // The command ran inside the workspace directory.
    const command = sandbox.commands.run.mock.calls.find(args =>
      String(args[0]).includes("http.server")
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
    expect(firstCallMessages[1].content).toContain(
      "Coding task:\n\nbuild a game"
    );
    // Every specialist tool call streamed as a running→completed activity
    // with its identifying args, in call order.
    expect(activities.map(a => `${a.id}:${a.name}:${a.state}`)).toEqual([
      "c1:list_files:running",
      "c1:list_files:completed",
      "c2:write_file:running",
      "c2:write_file:completed",
      "c3:run_command:running",
      "c3:run_command:completed",
    ]);
    expect(activities[2].args).toEqual({ path: "index.html" });
    expect(activities[3].summary).toBe("Wrote index.html.");
    expect(activities[4].args).toEqual({
      command: "python3 -m http.server --check",
    });
  });

  it("marks a failing command's activity as failed without breaking the loop", async () => {
    const sandbox = fakeSandbox();
    const activities: Array<{
      id: string;
      name: string;
      state: string;
      summary?: string;
    }> = [];
    sandbox.commands.run.mockImplementation(async (command: string) =>
      String(command).includes("find")
        ? { exitCode: 0, stdout: "./app.py\n", stderr: "" }
        : { exitCode: 2, stdout: "", stderr: "module not found" }
    );
    runNimAgentChatMock
      .mockResolvedValueOnce(
        toolCall("c1", "run_command", { command: "python3 app.py" })
      )
      .mockResolvedValueOnce(
        textReply("The command failed; here is the state.")
      );

    const outcome = await runAutonomousCoderTask({
      task: "run it",
      sandbox: sandbox as never,
      onToolActivity: activity => {
        activities.push(activity);
      },
    });

    expect(outcome.kind).toBe("autonomous");
    const settled = activities.filter(a => a.state !== "running");
    expect(settled).toHaveLength(1);
    expect(settled[0].state).toBe("failed");
    expect(settled[0].summary).toContain("Command failed");
    // The loop continued past the failure and summarized normally.
    expect(runNimAgentChatMock).toHaveBeenCalledTimes(2);
  });

  it("reports a failed workspace listing as failed instead of an empty workspace", async () => {
    const sandbox = fakeSandbox();
    const activities: Array<{
      id: string;
      name: string;
      state: string;
      summary?: string;
    }> = [];
    // The intro-prompt listing runs before the loop; make it fail, then have
    // the specialist's explicit list_files call fail the same way.
    sandbox.commands.run.mockRejectedValue(new Error("sandbox gone"));
    runNimAgentChatMock
      .mockResolvedValueOnce(toolCall("c1", "list_files", {}))
      .mockResolvedValueOnce(textReply("Could not list the workspace."));

    const outcome = await runAutonomousCoderTask({
      task: "see what is here",
      sandbox: sandbox as never,
      onToolActivity: activity => {
        activities.push(activity);
      },
    });

    // The intro prompt carried the failure text, not a clean empty listing.
    const firstPrompt = runNimAgentChatMock.mock.calls[0][0].messages[1]
      .content as string;
    expect(firstPrompt).toContain("could not list the workspace");
    const settled = activities.filter(a => a.state !== "running");
    expect(settled).toHaveLength(1);
    expect(settled[0].state).toBe("failed");
    expect(settled[0].summary).toContain("Could not list the workspace files");
    expect(outcome.kind).toBe("autonomous");
  });

  it("runs the autonomous loop on the editor's own endpoint and key", async () => {
    runNimAgentChatMock.mockResolvedValueOnce(textReply("Done."));
    await runAutonomousCoderTask({
      task: "do it",
      sandbox: fakeSandbox() as never,
    });
    const [options] = runNimAgentChatMock.mock.calls[0];
    expect(options.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(options.apiUrl).toBe("https://gen.pollinations.ai/v1");
    expect(options.apiKey).toBe("sk-poll");
  });

  it("falls back to the single-shot reply when the model rejects tools", async () => {
    runNimAgentChatMock.mockRejectedValueOnce(
      new NimToolsUnsupportedError(
        "NVIDIA NIM responded with status 400: tools unsupported."
      )
    );
    runNimChatMock.mockResolvedValueOnce("def solve(): pass");

    const outcome = await runAutonomousCoderTask({
      task: "write a solver",
      sandbox: fakeSandbox() as never,
    });

    expect(outcome).toEqual({
      kind: "single",
      code: "def solve(): pass",
      model: "deepseek/deepseek-v4.1-flash",
    });
  });

  it("has no step cap: keeps working past the old 12-round limit until the model summarizes", async () => {
    let calls = 0;
    runNimAgentChatMock.mockImplementation(async () => {
      calls += 1;
      if (calls < 15) return toolCall(`c${calls}`, "list_files", {});
      return textReply("All done.");
    });

    const outcome = await runAutonomousCoderTask({
      task: "a long task",
      sandbox: fakeSandbox() as never,
    });

    expect(calls).toBe(15);
    if (outcome.kind !== "autonomous")
      throw new Error("expected autonomous outcome");
    expect(outcome.summary).toBe("All done.");
    expect(outcome.rounds).toBe(15);
  });

  it("stops only when the segment budget runs out, reporting exactly what was done", async () => {
    // Fake wall clock: each model call appears to consume 20s of a 100s
    // budget, so the loop runs the clock out (deterministically) instead of
    // spinning forever on instant mocks. The specialist uses the full budget,
    // so it keeps going until the deadline itself passes.
    const startedAt = Date.now();
    const realNow = Date.now;
    let calls = 0;
    Date.now = () => startedAt + calls * 20_000;
    try {
      runNimAgentChatMock.mockImplementation(async () => {
        calls += 1;
        return toolCall(`c${calls}`, "list_files", {});
      });

      const outcome = await runAutonomousCoderTask({
        task: "an endless task",
        sandbox: fakeSandbox() as never,
        deadlineAtMs: startedAt + 100_000,
      });

      // No reserve is deducted, so the loop keeps starting rounds until the
      // clock reaches the deadline: 5 calls, then the honest report.
      expect(calls).toBe(5);
      if (outcome.kind !== "autonomous")
        throw new Error("expected autonomous outcome");
      expect(outcome.summary).toContain("full time budget");
      expect(outcome.rounds).toBe(5);
      expect(outcome.writtenPaths).toEqual([]);
      expect(outcome.commandsRun).toBe(0);
      // The caller's deadline is handed to the model call as its hard
      // deadline, so a retry cannot overrun it and get the result discarded.
      expect(runNimAgentChatMock.mock.calls[0][0].deadlineAtMs).toBe(
        startedAt + 100_000
      );
    } finally {
      Date.now = realNow;
    }
  });

  it("reports honestly when there is no time left to start instead of claiming failed work", async () => {
    const outcome = await runAutonomousCoderTask({
      task: "a task delegated with the segment already over",
      sandbox: fakeSandbox() as never,
      deadlineAtMs: Date.now() - 1_000,
    });

    expect(runNimAgentChatMock).not.toHaveBeenCalled();
    if (outcome.kind !== "autonomous")
      throw new Error("expected autonomous outcome");
    expect(outcome.summary).toContain("could not start");
    expect(outcome.summary).toContain("0 file(s)");
    expect(outcome.rounds).toBe(0);
    expect(outcome.writtenPaths).toEqual([]);
  });

  it("rejects unsafe write paths without touching the sandbox", async () => {
    const sandbox = fakeSandbox();
    runNimAgentChatMock
      .mockResolvedValueOnce(
        toolCall("c1", "write_file", {
          path: "../outside.txt",
          content: "nope",
        })
      )
      .mockResolvedValueOnce(textReply("Nothing to do."));

    await runAutonomousCoderTask({
      task: "do something",
      sandbox: sandbox as never,
    });

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

  it("writes file content byte-exact, preserving indentation and trailing newlines", async () => {
    const sandbox = fakeSandbox();
    const content = "  indented()\n\n# trailing newline\n";
    runNimAgentChatMock
      .mockResolvedValueOnce(
        toolCall("c1", "write_file", { path: "app.py", content })
      )
      .mockResolvedValueOnce(textReply("Done."));

    await runAutonomousCoderTask({
      task: "write it",
      sandbox: sandbox as never,
    });

    expect(sandbox.writes).toEqual([
      { path: "/home/user/workspace/app.py", content },
    ]);
  });

  it("rejects shell deletes and renames at the boundary", async () => {
    const sandbox = fakeSandbox();
    runNimAgentChatMock
      .mockResolvedValueOnce(
        toolCall("c1", "run_command", { command: "rm -rf src" })
      )
      .mockResolvedValueOnce(
        toolCall("c2", "run_command", { command: "git mv a.py b.py" })
      )
      .mockResolvedValueOnce(textReply("Done."));

    await runAutonomousCoderTask({
      task: "clean up",
      sandbox: sandbox as never,
    });

    const toolResults = runNimAgentChatMock.mock.calls[2][0].messages.filter(
      m => m.role === "tool"
    );
    expect(toolResults[0].content).toContain(
      "Rejected: this workspace must not delete"
    );
    expect(toolResults[1].content).toContain(
      "Rejected: this workspace must not delete"
    );
    // The destructive commands never reached the sandbox.
    expect(
      sandbox.commands.run.mock.calls.some(args =>
        String(args[0]).includes("rm -rf")
      )
    ).toBe(false);
    expect(
      sandbox.commands.run.mock.calls.some(args =>
        String(args[0]).includes("git mv")
      )
    ).toBe(false);
  });

  it("reports partial work instead of throwing when a mid-task model call fails", async () => {
    const sandbox = fakeSandbox();
    runNimAgentChatMock
      .mockResolvedValueOnce(
        toolCall("c1", "write_file", {
          path: "half.py",
          content: "print('half')",
        })
      )
      .mockRejectedValueOnce(
        new Error("NVIDIA NIM responded with status 502.")
      );

    const outcome = await runAutonomousCoderTask({
      task: "build it",
      sandbox: sandbox as never,
    });

    if (outcome.kind !== "autonomous")
      throw new Error("expected autonomous outcome");
    expect(outcome.summary).toContain("failure mid-task");
    expect(outcome.summary).toContain("status 502");
    expect(outcome.writtenPaths).toEqual(["half.py"]);
  });

  it("compacts the conversation and continues when the model rejects an over-long context", async () => {
    const sandbox = fakeSandbox();
    const progress: string[] = [];
    // A long assistant turn is what compaction can free; the context-length
    // rejection must not abort the task NOR fall back to a single-shot reply.
    runNimAgentChatMock
      .mockResolvedValueOnce({
        kind: "tool_calls" as const,
        text: "x".repeat(3_000),
        toolCalls: [{ id: "c1", name: "list_files", arguments: "{}" }],
      })
      .mockRejectedValueOnce(
        new NimContextLengthError(
          "The coding service responded with status 400: maximum context length exceeded."
        )
      )
      .mockResolvedValueOnce(textReply("Done."));

    const outcome = await runAutonomousCoderTask({
      task: "a long task",
      sandbox: sandbox as never,
      onProgress: note => progress.push(note),
    });

    expect(outcome.kind).toBe("autonomous");
    expect(outcome.summary).toBe("Done.");
    expect(runNimAgentChatMock).toHaveBeenCalledTimes(3);
    // The retry after compaction no longer carries the long assistant text.
    const retryMessages = runNimAgentChatMock.mock.calls[2][0].messages;
    const longAssistant = retryMessages.find(
      (m: { role: string }) => m.role === "assistant"
    );
    expect(String(longAssistant.content).length).toBeLessThan(3_000);
    expect(progress.join(" ")).toContain("context window");
  });

  it("stops honestly when the context overflows and cannot be compacted further", async () => {
    const sandbox = fakeSandbox();
    // Only short exchange so far: aggressive compaction frees nothing, so the
    // specialist reports exactly what it did instead of retrying forever.
    runNimAgentChatMock
      .mockResolvedValueOnce(toolCall("c1", "list_files", {}))
      .mockRejectedValueOnce(
        new NimContextLengthError(
          "The coding service responded with status 400: maximum context length exceeded."
        )
      );

    const outcome = await runAutonomousCoderTask({
      task: "a long task",
      sandbox: sandbox as never,
    });

    if (outcome.kind !== "autonomous")
      throw new Error("expected autonomous outcome");
    expect(outcome.summary).toContain("context window");
    expect(outcome.summary).toContain("fresh, smaller task");
    expect(outcome.writtenPaths).toEqual([]);
    expect(runNimAgentChatMock).toHaveBeenCalledTimes(2);
  });

  it("reports a budget stop when compaction succeeds but the segment has no time left", async () => {
    const sandbox = fakeSandbox();
    // The first round's long assistant text is compactable, so hard compaction
    // frees space - but the deadline is already too close to retry, so the
    // specialist must report the budget, not a compaction failure.
    runNimAgentChatMock
      .mockResolvedValueOnce({
        kind: "tool_calls" as const,
        text: "x".repeat(3_000),
        toolCalls: [{ id: "c1", name: "list_files", arguments: "{}" }],
      })
      .mockRejectedValueOnce(
        new NimContextLengthError(
          "The coding service responded with status 400: maximum context length exceeded."
        )
      );

    const outcome = await runAutonomousCoderTask({
      task: "a long task",
      sandbox: sandbox as never,
      deadlineAtMs: Date.now() + 25_000,
    });

    if (outcome.kind !== "autonomous")
      throw new Error("expected autonomous outcome");
    expect(outcome.summary).toContain("ran out of time");
    expect(outcome.summary).not.toContain("could no longer be compacted");
    expect(runNimAgentChatMock).toHaveBeenCalledTimes(2);
  });

  it("does not start a tool call once the segment deadline has passed", async () => {
    const sandbox = fakeSandbox();
    const startedAt = Date.now();
    const realNow = Date.now;
    let advanced = false;
    // The model round itself outlasts the deadline, so the tool calls it
    // returns must be skipped rather than executed after the segment closed.
    Date.now = () => (advanced ? startedAt + 200 : startedAt);
    try {
      runNimAgentChatMock.mockImplementationOnce(async () => {
        advanced = true;
        return toolCall("c1", "run_command", {
          command: "touch should-not-exist",
        });
      });

      const outcome = await runAutonomousCoderTask({
        task: "an impossible task",
        sandbox: sandbox as never,
        deadlineAtMs: startedAt + 100,
      });

      const ran = sandbox.commands.run.mock.calls.map(call => String(call[0]));
      expect(
        ran.some(command => command.includes("should-not-exist"))
      ).toBe(false);
      if (outcome.kind !== "autonomous")
        throw new Error("expected autonomous outcome");
      expect(outcome.commandsRun).toBe(0);
    } finally {
      Date.now = realNow;
    }
  });

  it("drops the file payloads of old tool calls so repeated large writes cannot pin the context open", async () => {
    const sandbox = fakeSandbox();
    const big = "A".repeat(3_000);
    runNimAgentChatMock
      .mockResolvedValueOnce(
        toolCall("w1", "write_file", { path: "big.txt", content: big })
      )
      .mockResolvedValueOnce(toolCall("l2", "list_files", {}))
      .mockResolvedValueOnce(toolCall("l3", "list_files", {}))
      .mockResolvedValueOnce(toolCall("l4", "list_files", {}))
      .mockRejectedValueOnce(
        new NimContextLengthError(
          "The coding service responded with status 400: maximum context length exceeded."
        )
      )
      .mockResolvedValueOnce(textReply("Done."));

    const outcome = await runAutonomousCoderTask({
      task: "write a big file",
      sandbox: sandbox as never,
    });

    expect(outcome.kind).toBe("autonomous");
    expect(outcome.summary).toBe("Done.");
    // The retry after compaction keeps the old call (paired result intact) but
    // no longer carries its file payload.
    const retryMessages = runNimAgentChatMock.mock.calls[5][0].messages;
    const firstAssistant = retryMessages.find(
      (m: { role: string }) => m.role === "assistant"
    );
    expect(firstAssistant.tool_calls[0].function.arguments).toBe("{}");
    expect(JSON.stringify(retryMessages)).not.toContain(big);
  });
});
