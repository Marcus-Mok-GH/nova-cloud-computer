import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCoderTask } from "./coder";

const state = vi.hoisted(() => ({ nimModel: "moonshotai/kimi-k3" }));
vi.mock("./_core/env", () => ({
  ENV: { get nimCoderModel() { return state.nimModel; } },
}));

const runNimChatMock = vi.hoisted(() => vi.fn());
vi.mock("./nim", () => ({ runNimChat: runNimChatMock }));

beforeEach(() => {
  runNimChatMock.mockReset();
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
