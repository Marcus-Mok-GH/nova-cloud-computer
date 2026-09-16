import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentRunProgressReporter,
  classifyBlocker,
  estimateEtaForRequest,
  formatEtaRange,
  remainingEtaSeconds,
  shouldNotifyBlocker,
} from "./agentProgress";

describe("formatEtaRange", () => {
  it("renders sub-minute windows in human steps", () => {
    expect(formatEtaRange({ low: 9, high: 18 })).toBe("10–30 seconds");
    expect(formatEtaRange({ low: 4, high: 5 })).toBe("5 seconds");
  });

  it("collapses to a single unit once the window crosses a minute", () => {
    expect(formatEtaRange({ low: 45, high: 120 })).toBe("1–2 minutes");
    expect(formatEtaRange({ low: 100, high: 110 })).toBe("2 minutes");
  });
});

describe("estimateEtaForRequest", () => {
  it("estimates research-heavy requests far longer than trivial workspace ops", () => {
    const research = estimateEtaForRequest("Research the latest news on quantum computing and write me a summary");
    const trivial = estimateEtaForRequest("Rename notes.txt to todo.txt");
    expect(research.high).toBeGreaterThan(trivial.high);
    expect(formatEtaRange(research)).toMatch(/minute/);
  });

  it("keeps simple file operations within seconds", () => {
    const simple = estimateEtaForRequest("Create a file called hello.txt");
    expect(simple.high).toBeLessThan(60);
  });
});

describe("remainingEtaSeconds", () => {
  it("projects about one more round per completed round, minus elapsed time", () => {
    expect(remainingEtaSeconds(0, 0)).toBe(25);
    expect(remainingEtaSeconds(2, 30)).toBe(45);
  });

  it("clamps to a sane floor and ceiling", () => {
    expect(remainingEtaSeconds(1, 1_000_000)).toBe(10);
    expect(remainingEtaSeconds(500, 0)).toBe(900);
  });
});

describe("classifyBlocker", () => {
  it("flags connection, credential, and allowance failures as needing the user", () => {
    expect(classifyBlocker("Telegram is not connected for this user.")).toBe("user_action");
    expect(classifyBlocker("The API key is unauthorized.")).toBe("user_action");
    expect(classifyBlocker("The request allowance is exhausted.")).toBe("user_action");
  });

  it("treats ordinary tool mishaps as something the agent can recover from", () => {
    expect(classifyBlocker("Exa research request failed after retries.")).toBe("recovering");
    expect(classifyBlocker("Folder not found: tmp.")).toBe("recovering");
  });
});

describe("shouldNotifyBlocker", () => {
  it("suppresses trivial argument mistakes the model self-corrects instantly", () => {
    expect(shouldNotifyBlocker("create_file", "A file name is required.")).toBe(false);
    expect(shouldNotifyBlocker("move_file", "File not found: old.txt.")).toBe(false);
    expect(shouldNotifyBlocker("edit_file", "Invalid JSON arguments.")).toBe(false);
  });

  it("notifies for real failures of effectful tools", () => {
    expect(shouldNotifyBlocker("send_telegram_message", "Telegram is not connected for this user.")).toBe(true);
    expect(shouldNotifyBlocker("research_web", "Exa research request failed.")).toBe(true);
  });
});

describe("AgentRunProgressReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces an ETA the moment the run starts", async () => {
    const sink = vi.fn();
    const reporter = new AgentRunProgressReporter(sink);
    await reporter.runStarted("Create a file called notes.txt with my grocery list");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(String(sink.mock.calls[0][0])).toMatch(/I'll get this done within about .* seconds\./);
  });

  it("sends blockers immediately with a recovery plan, distinguishing user action from self-recovery", async () => {
    const sink = vi.fn();
    const reporter = new AgentRunProgressReporter(sink);
    await reporter.blocker("use_connector_tool", "GitHub is not connected. Open Settings and connect it first.");
    await reporter.blocker("research_web", "Exa research request failed after retries.");
    expect(sink).toHaveBeenCalledTimes(2);
    expect(String(sink.mock.calls[0][0])).toMatch(/🚧 Blocker: use_connector_tool/);
    expect(String(sink.mock.calls[0][0])).toMatch(/can't finish this part without you/);
    expect(String(sink.mock.calls[1][0])).toMatch(/⚠️ Heads-up: research_web/);
    expect(String(sink.mock.calls[1][0])).toMatch(/no action needed from you/);
  });

  it("throttles round updates so long runs do not spam the chat", async () => {
    const sink = vi.fn();
    const reporter = new AgentRunProgressReporter(sink, 20_000);
    await reporter.runStarted("list my files");
    expect(sink).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    await reporter.roundCompleted(["create_file", "read_file"], 0);
    expect(sink).toHaveBeenCalledTimes(1); // still fresh — throttled

    vi.advanceTimersByTime(30_000);
    await reporter.roundCompleted(["edit_file"], 1);
    expect(sink).toHaveBeenCalledTimes(2);
    const update = String(sink.mock.calls[1][0]);
    expect(update).toMatch(/3 steps done so far/);
    expect(update).toMatch(/Revised ETA/);
    expect(update).toMatch(/1 snag worked around/);
  });

  it("caps blocker notices at three per run so a flaky tool cannot flood the chat", async () => {
    const sink = vi.fn();
    const reporter = new AgentRunProgressReporter(sink);
    for (let i = 0; i < 5; i += 1) {
      await reporter.blocker("run_vm_task", `VM task failed on attempt ${i}: sandbox timed out.`);
    }
    expect(sink).toHaveBeenCalledTimes(3);
  });

  it("never lets a failing sink break the run or count as delivered progress", async () => {
    const sink = vi.fn(async () => {
      throw new Error("Telegram is down");
    });
    const reporter = new AgentRunProgressReporter(sink);
    await expect(reporter.runStarted("hello")).rejects.toThrow("Telegram is down");
    // The caller (webhook) wraps progress sends in .catch, so a rejected
    // sink does not stop the agent run itself.
  });
});
