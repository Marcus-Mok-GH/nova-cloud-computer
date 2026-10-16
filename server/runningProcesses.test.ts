import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunningProcess } from "../drizzle/schema";

const hoisted = vi.hoisted(() => ({
  env: { agentContinueSecret: "", publicBaseUrl: "" } as Record<
    string,
    string | undefined
  >,
  registerRunningProcess: vi.fn(async () => undefined as unknown),
  heartbeatRunningProcesses: vi.fn(async () => {}),
  finishRunningProcess: vi.fn(async () => undefined as unknown),
  listStaleRunningProcesses: vi.fn(async () => [] as unknown[]),
  claimRunningProcess: vi.fn(async () => undefined as unknown),
  failRunningProcess: vi.fn(async () => undefined as unknown),
  hasLiveRunningProcessForChat: vi.fn(async () => false),
  hasOpenEditorProcessForChat: vi.fn(async () => false),
  getAgentRunById: vi.fn(async () => undefined as unknown),
  failAgentRunById: vi.fn(async () => undefined as unknown),
  getWorkspaceById: vi.fn(async () => undefined as unknown),
  hasAgentStopAfter: vi.fn(async () => false),
  holdAgentRunForContinue: vi.fn(async () => undefined as unknown),
  appendChatMessageForUser: vi.fn(async () => ({})),
  getChatForUser: vi.fn(async () => undefined as unknown),
  scheduleContinuation: vi.fn(async () => true),
  runAutonomousCoderTask: vi.fn(async () => ({
    kind: "autonomous" as const,
    summary: "Built the site.",
    writtenPaths: ["index.html"],
    commandsRun: 1,
    rounds: 2,
    model: "coder-model",
  })),
  syncAgentSandbox: vi.fn(async () => 3),
  ensurePersistentSandbox: vi.fn(async () => ({ sandboxId: "sbx-1" })),
  getE2BClient: vi.fn(() => ({}) as unknown),
  backgroundWork: [] as Array<Promise<unknown>>,
}));

vi.mock("./_core/env", () => ({ ENV: hoisted.env }));
vi.mock("./backgroundWork", () => ({
  trackBackgroundWork: (work: Promise<unknown>) => {
    hoisted.backgroundWork.push(work);
  },
}));
vi.mock("./db", () => ({
  registerRunningProcess: hoisted.registerRunningProcess,
  heartbeatRunningProcesses: hoisted.heartbeatRunningProcesses,
  finishRunningProcess: hoisted.finishRunningProcess,
  listStaleRunningProcesses: hoisted.listStaleRunningProcesses,
  claimRunningProcess: hoisted.claimRunningProcess,
  failRunningProcess: hoisted.failRunningProcess,
  hasLiveRunningProcessForChat: hoisted.hasLiveRunningProcessForChat,
  hasOpenEditorProcessForChat: hoisted.hasOpenEditorProcessForChat,
  getAgentRunById: hoisted.getAgentRunById,
  failAgentRunById: hoisted.failAgentRunById,
  getWorkspaceById: hoisted.getWorkspaceById,
  hasAgentStopAfter: hoisted.hasAgentStopAfter,
  holdAgentRunForContinue: hoisted.holdAgentRunForContinue,
  appendChatMessageForUser: hoisted.appendChatMessageForUser,
  getChatForUser: hoisted.getChatForUser,
}));
vi.mock("./coder", () => ({
  runAutonomousCoderTask: hoisted.runAutonomousCoderTask,
}));
vi.mock("./sandboxWorkspace", () => ({
  syncAgentSandbox: hoisted.syncAgentSandbox,
}));
vi.mock("./e2b", () => ({
  ensurePersistentSandbox: hoisted.ensurePersistentSandbox,
  getE2BClient: hoisted.getE2BClient,
}));
vi.mock("./workspace/workspaceAgent", () => ({ MAX_RUN_BUDGET_MS: 285_000 }));
vi.mock("./agentRuns", () => ({
  scheduleContinuation: hoisted.scheduleContinuation,
}));

const {
  MAX_PROCESS_RESUME_ATTEMPTS,
  PROCESS_HEARTBEAT_INTERVAL_MS,
  kickRunningProcessRecovery,
  reapOrphanedRunningProcesses,
  resetRunningProcessRecoveryForTests,
  resumeRunningProcess,
  trackAgentRunProcess,
  trackRunningProcess,
} = await import("./runningProcesses");

const workspaceRow = {
  id: 51,
  ownerId: 7,
  name: "Nova",
  description: null,
  persistentSandboxId: "sbx-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function processRow(overrides: Partial<RunningProcess> = {}): RunningProcess {
  return {
    id: 1,
    workspaceId: 51,
    chatId: "chat-abc",
    kind: "editor",
    status: "running",
    payload: { task: "Build the landing page" },
    heartbeatAt: new Date(Date.now() - 120_000),
    attempts: 1,
    errorMessage: null,
    startedAt: new Date(Date.now() - 300_000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RunningProcess;
}

/** Awaits every background promise the code under test registered (including ones queued while draining). */
async function flushBackgroundWork(): Promise<void> {
  for (let guard = 0; guard < 10; guard += 1) {
    const batch = hoisted.backgroundWork.splice(0);
    if (batch.length === 0) return;
    await Promise.all(batch);
  }
}

describe("Running-process recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hoisted.backgroundWork.length = 0;
    hoisted.env.agentContinueSecret = "";
    hoisted.env.publicBaseUrl = "";
    resetRunningProcessRecoveryForTests();
    // Defaults every test starts from; individual tests override what they exercise.
    hoisted.getE2BClient.mockImplementation(() => ({}));
    hoisted.ensurePersistentSandbox.mockResolvedValue({ sandboxId: "sbx-1" });
    hoisted.runAutonomousCoderTask.mockResolvedValue({
      kind: "autonomous",
      summary: "Built the site.",
      writtenPaths: ["index.html"],
      commandsRun: 1,
      rounds: 2,
      model: "coder-model",
    });
    hoisted.syncAgentSandbox.mockResolvedValue(3);
    hoisted.appendChatMessageForUser.mockResolvedValue({});
    hoisted.heartbeatRunningProcesses.mockResolvedValue(undefined);
    hoisted.finishRunningProcess.mockResolvedValue(undefined);
    hoisted.failRunningProcess.mockResolvedValue(undefined);
    hoisted.failAgentRunById.mockResolvedValue(undefined);
    hoisted.getWorkspaceById.mockResolvedValue(undefined);
    hoisted.getAgentRunById.mockResolvedValue(undefined);
    hoisted.getChatForUser.mockResolvedValue(undefined);
    hoisted.hasAgentStopAfter.mockResolvedValue(false);
    hoisted.hasLiveRunningProcessForChat.mockResolvedValue(false);
    hoisted.hasOpenEditorProcessForChat.mockResolvedValue(false);
    hoisted.holdAgentRunForContinue.mockResolvedValue(undefined);
    hoisted.scheduleContinuation.mockResolvedValue(true);
    hoisted.claimRunningProcess.mockResolvedValue(undefined);
    hoisted.listStaleRunningProcesses.mockResolvedValue([]);
    hoisted.registerRunningProcess.mockImplementation(
      async (input: {
        workspaceId: number;
        chatId?: string | null;
        kind: string;
      }) =>
        processRow({
          workspaceId: input.workspaceId,
          chatId: input.chatId ?? null,
          kind: input.kind,
          payload: {},
        })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("trackRunningProcess", () => {
    it("registers the row before the work, beats its heartbeat, and closes it on finish", async () => {
      vi.useFakeTimers();
      const handle = await trackRunningProcess({
        workspaceId: 51,
        chatId: "chat-abc",
        kind: "editor",
        payload: { task: "Build the landing page" },
      });
      expect(handle).toBeDefined();
      expect(hoisted.registerRunningProcess).toHaveBeenCalledWith({
        workspaceId: 51,
        chatId: "chat-abc",
        kind: "editor",
        payload: { task: "Build the landing page" },
      });

      vi.advanceTimersByTime(PROCESS_HEARTBEAT_INTERVAL_MS * 2 + 1);
      expect(hoisted.heartbeatRunningProcesses).toHaveBeenCalledTimes(2);

      await handle!.finish("completed");
      vi.advanceTimersByTime(PROCESS_HEARTBEAT_INTERVAL_MS * 2);
      expect(hoisted.heartbeatRunningProcesses).toHaveBeenCalledTimes(2);
      expect(hoisted.finishRunningProcess).toHaveBeenCalledWith(
        handle!.id,
        "completed",
        undefined
      );
      // finish is idempotent.
      await handle!.finish("completed");
      expect(hoisted.finishRunningProcess).toHaveBeenCalledTimes(1);
    });

    it("returns no handle when the row cannot be registered, so the work is never blocked", async () => {
      hoisted.registerRunningProcess.mockRejectedValueOnce(
        new Error("db down")
      );
      const handle = await trackRunningProcess({
        workspaceId: 51,
        kind: "editor",
        payload: { task: "x" },
      });
      expect(handle).toBeUndefined();
    });

    it("resolves the workspace for an agent-run process and carries its resume payload", async () => {
      hoisted.getChatForUser.mockResolvedValueOnce({
        id: "chat-abc",
        workspaceId: 51,
      });
      const handle = await trackAgentRunProcess({
        ownerId: 7,
        chatId: "chat-abc",
        runId: 42,
        segment: 1,
        chainable: true,
      });
      expect(hoisted.registerRunningProcess).toHaveBeenCalledWith({
        workspaceId: 51,
        chatId: "chat-abc",
        kind: "agent_run",
        payload: { runId: 42, segment: 1, chainable: true },
      });
      await handle!.finish("completed");
    });
  });

  describe("resumeRunningProcess (editor)", () => {
    it("reconnects the sandbox, finishes the coding task, syncs, and posts the result to the chat", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      const row = processRow({
        kind: "editor",
        attempts: 1,
        payload: {
          task: "Build the landing page",
          context: "existing code",
          language: "ts",
        },
      });

      await resumeRunningProcess(row);

      expect(hoisted.ensurePersistentSandbox).toHaveBeenCalledWith(
        {},
        51,
        7,
        "sbx-1"
      );
      expect(hoisted.runAutonomousCoderTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task: "Build the landing page",
          context: "existing code",
          language: "ts",
          sandbox: { sandboxId: "sbx-1" },
        })
      );
      expect(hoisted.syncAgentSandbox).toHaveBeenCalledWith(7, 51, {
        sandboxId: "sbx-1",
      });
      expect(hoisted.finishRunningProcess).toHaveBeenCalledWith(1, "completed");
      expect(hoisted.appendChatMessageForUser).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          chatId: "chat-abc",
          role: "assistant",
          content: expect.stringContaining("resumed automatically"),
        })
      );
    });

    it("refuses to resurrect work the user stopped while it was dead", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.hasAgentStopAfter.mockResolvedValueOnce(true);
      const row = processRow({ kind: "editor" });

      await resumeRunningProcess(row);

      expect(hoisted.runAutonomousCoderTask).not.toHaveBeenCalled();
      expect(hoisted.failRunningProcess).toHaveBeenCalledWith(
        1,
        expect.stringContaining("stopped by the user")
      );
    });

    it("dead-letters a row whose stored payload lost the coding task", async () => {
      await resumeRunningProcess(processRow({ kind: "editor", payload: {} }));
      expect(hoisted.runAutonomousCoderTask).not.toHaveBeenCalled();
      expect(hoisted.failRunningProcess).toHaveBeenCalledWith(
        1,
        expect.stringContaining("payload was incomplete")
      );
    });

    it("fails honestly when the sandbox cannot be reopened", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.ensurePersistentSandbox.mockRejectedValueOnce(
        new Error("sandbox gone")
      );

      await resumeRunningProcess(processRow({ kind: "editor" }));

      expect(hoisted.runAutonomousCoderTask).not.toHaveBeenCalled();
      expect(hoisted.finishRunningProcess).toHaveBeenCalledWith(
        1,
        "failed",
        expect.stringContaining("sandbox")
      );
      expect(hoisted.appendChatMessageForUser).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          chatId: "chat-abc",
          content: expect.stringContaining("could not be reopened"),
        })
      );
    });

    it("closes the row as failed on a final-attempt failure and tells the chat, staying quiet on earlier attempts", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.runAutonomousCoderTask.mockRejectedValueOnce(
        new Error("specialist crashed")
      );
      await resumeRunningProcess(processRow({ kind: "editor", attempts: 1 }));
      expect(hoisted.finishRunningProcess).toHaveBeenCalledWith(
        1,
        "failed",
        "specialist crashed"
      );
      expect(hoisted.appendChatMessageForUser).not.toHaveBeenCalled();

      hoisted.runAutonomousCoderTask.mockRejectedValueOnce(
        new Error("specialist crashed")
      );
      await resumeRunningProcess(
        processRow({
          id: 2,
          kind: "editor",
          attempts: MAX_PROCESS_RESUME_ATTEMPTS,
        })
      );
      expect(hoisted.appendChatMessageForUser).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          chatId: "chat-abc",
          content: expect.stringContaining("could not be resumed"),
        })
      );
    });
  });

  describe("resumeRunningProcess (agent_run)", () => {
    const openRun = {
      id: 9,
      workspaceId: 51,
      chatId: "chat-abc",
      status: "running",
      segment: 2,
    };

    it("holds the killed segment's ledger row and chains a continuation", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.getAgentRunById.mockResolvedValue(openRun);
      hoisted.holdAgentRunForContinue.mockResolvedValue({
        id: 9,
        status: "awaiting_continue",
      });

      await resumeRunningProcess(
        processRow({
          kind: "agent_run",
          payload: { runId: 9, segment: 2, chainable: true },
        })
      );

      expect(hoisted.holdAgentRunForContinue).toHaveBeenCalledWith(7, 9);
      expect(hoisted.scheduleContinuation).toHaveBeenCalledWith(9, 2);
      expect(hoisted.finishRunningProcess).toHaveBeenCalledWith(1, "completed");
    });

    it("resumes an already-held continuation row without holding it again", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.getAgentRunById.mockResolvedValue({
        ...openRun,
        status: "awaiting_continue",
      });

      await resumeRunningProcess(
        processRow({
          kind: "agent_run",
          payload: { runId: 9, segment: 2, chainable: true },
        })
      );

      expect(hoisted.holdAgentRunForContinue).not.toHaveBeenCalled();
      expect(hoisted.scheduleContinuation).toHaveBeenCalledWith(9, 2);
      expect(hoisted.finishRunningProcess).toHaveBeenCalledWith(1, "completed");
    });

    it("does nothing when a later segment already took over after this one", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.getAgentRunById.mockResolvedValue({ ...openRun, segment: 3 });

      await resumeRunningProcess(
        processRow({
          kind: "agent_run",
          payload: { runId: 9, segment: 2, chainable: true },
        })
      );

      expect(hoisted.holdAgentRunForContinue).not.toHaveBeenCalled();
      expect(hoisted.scheduleContinuation).not.toHaveBeenCalled();
      expect(hoisted.finishRunningProcess).toHaveBeenCalledWith(1, "completed");
    });

    it("closes out when the run already ended before the resume could start", async () => {
      hoisted.getAgentRunById.mockResolvedValue({
        ...openRun,
        status: "completed",
      });

      await resumeRunningProcess(
        processRow({
          kind: "agent_run",
          payload: { runId: 9, segment: 2, chainable: true },
        })
      );

      expect(hoisted.scheduleContinuation).not.toHaveBeenCalled();
      expect(hoisted.finishRunningProcess).toHaveBeenCalledWith(1, "completed");
    });

    it("defers while a live editor process is still working in the same chat", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.getAgentRunById.mockResolvedValue(openRun);
      hoisted.hasLiveRunningProcessForChat.mockResolvedValueOnce(true);

      await resumeRunningProcess(
        processRow({
          kind: "agent_run",
          payload: { runId: 9, segment: 2, chainable: true },
        })
      );

      expect(hoisted.holdAgentRunForContinue).not.toHaveBeenCalled();
      expect(hoisted.scheduleContinuation).not.toHaveBeenCalled();
      // The row stays live for the next sweep to pick up once the editor closes.
      expect(hoisted.finishRunningProcess).not.toHaveBeenCalled();
      expect(hoisted.failRunningProcess).not.toHaveBeenCalled();
    });

    it("leaves the row for the next sweep when the continuation could not be scheduled", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.getAgentRunById.mockResolvedValue(openRun);
      hoisted.holdAgentRunForContinue.mockResolvedValue({
        id: 9,
        status: "awaiting_continue",
      });
      hoisted.scheduleContinuation.mockResolvedValueOnce(false);

      await resumeRunningProcess(
        processRow({
          kind: "agent_run",
          payload: { runId: 9, segment: 2, chainable: true },
        })
      );

      expect(hoisted.finishRunningProcess).not.toHaveBeenCalled();
      expect(hoisted.failRunningProcess).not.toHaveBeenCalled();
    });

    it("fails a non-chainable run (team chat) instead of looping on it", async () => {
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.getAgentRunById.mockResolvedValue(openRun);

      await resumeRunningProcess(
        processRow({
          kind: "agent_run",
          payload: { runId: 9, segment: 2, chainable: false },
        })
      );

      expect(hoisted.failRunningProcess).toHaveBeenCalledWith(
        1,
        expect.stringContaining("does not chain")
      );
      expect(hoisted.failAgentRunById).toHaveBeenCalledWith(
        9,
        expect.stringContaining("cannot be resumed")
      );
      expect(hoisted.scheduleContinuation).not.toHaveBeenCalled();
    });
  });

  describe("reapOrphanedRunningProcesses", () => {
    it("dispatches an interrupted editor task first and defers its parent run while the editor owns the chat", async () => {
      const exhaustedEditor = processRow({
        id: 1,
        kind: "editor",
        attempts: MAX_PROCESS_RESUME_ATTEMPTS,
        payload: { task: "x" },
      });
      const editor = processRow({
        id: 2,
        kind: "editor",
        attempts: 1,
        payload: { task: "y" },
      });
      const run = processRow({
        id: 3,
        kind: "agent_run",
        attempts: 0,
        payload: { runId: 9, segment: 2, chainable: true },
      });
      hoisted.listStaleRunningProcesses.mockResolvedValueOnce([
        run,
        exhaustedEditor,
        editor,
      ]);
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      // The editor row is open (stale or beating), so the run must wait.
      hoisted.hasOpenEditorProcessForChat.mockResolvedValue(true);
      const claimOrder: number[] = [];
      hoisted.claimRunningProcess.mockImplementation(async (id: number) => {
        claimOrder.push(id);
        return editor;
      });

      const result = await reapOrphanedRunningProcesses();

      // Only the editor was claimed and dispatched; the run deferred without
      // burning one of its resume attempts.
      expect(result.dispatched).toBe(1);
      expect(hoisted.failRunningProcess).toHaveBeenCalledWith(
        1,
        expect.stringContaining("killed")
      );
      expect(hoisted.hasOpenEditorProcessForChat).toHaveBeenCalledWith(
        "chat-abc",
        3
      );
      expect(claimOrder).toEqual([2]);
      await flushBackgroundWork();
      expect(hoisted.runAutonomousCoderTask).toHaveBeenCalledWith(
        expect.objectContaining({ task: "y" })
      );
      expect(hoisted.scheduleContinuation).not.toHaveBeenCalled();
    });

    it("chains the interrupted run's continuation once its editor sub-agent has closed", async () => {
      const run = processRow({
        id: 3,
        kind: "agent_run",
        attempts: 0,
        payload: { runId: 9, segment: 2, chainable: true },
      });
      hoisted.listStaleRunningProcesses.mockResolvedValueOnce([run]);
      hoisted.hasOpenEditorProcessForChat.mockResolvedValueOnce(false);
      hoisted.getWorkspaceById.mockResolvedValue(workspaceRow);
      hoisted.getAgentRunById.mockResolvedValue({
        id: 9,
        workspaceId: 51,
        chatId: "chat-abc",
        status: "running",
        segment: 2,
      });
      hoisted.holdAgentRunForContinue.mockResolvedValue({
        id: 9,
        status: "awaiting_continue",
      });
      hoisted.claimRunningProcess.mockResolvedValueOnce(run);

      const result = await reapOrphanedRunningProcesses();

      expect(result.dispatched).toBe(1);
      await flushBackgroundWork();
      expect(hoisted.holdAgentRunForContinue).toHaveBeenCalledWith(7, 9);
      expect(hoisted.scheduleContinuation).toHaveBeenCalledWith(9, 2);
    });

    it("dead-letters an exhausted agent-run row and closes its ledger row too", async () => {
      const run = processRow({
        id: 5,
        kind: "agent_run",
        attempts: MAX_PROCESS_RESUME_ATTEMPTS,
        payload: { runId: 9, segment: 2, chainable: true },
      });
      hoisted.listStaleRunningProcesses.mockResolvedValueOnce([run]);

      const result = await reapOrphanedRunningProcesses();

      expect(result.dispatched).toBe(0);
      expect(hoisted.failRunningProcess).toHaveBeenCalledWith(
        5,
        expect.stringContaining("killed")
      );
      expect(hoisted.failAgentRunById).toHaveBeenCalledWith(
        9,
        expect.any(String)
      );
      expect(hoisted.claimRunningProcess).not.toHaveBeenCalled();
    });

    it("does nothing when every heartbeat is fresh", async () => {
      const result = await reapOrphanedRunningProcesses();
      expect(result.dispatched).toBe(0);
      expect(hoisted.claimRunningProcess).not.toHaveBeenCalled();
    });
  });

  describe("kickRunningProcessRecovery", () => {
    it("sweeps once per throttle window and swallows sweep failures", async () => {
      hoisted.listStaleRunningProcesses.mockRejectedValueOnce(
        new Error("db down")
      );
      kickRunningProcessRecovery();
      kickRunningProcessRecovery(); // inside the throttle window: no second sweep
      await flushBackgroundWork();
      expect(hoisted.listStaleRunningProcesses).toHaveBeenCalledTimes(1);

      resetRunningProcessRecoveryForTests(); // stands in for the window elapsing
      kickRunningProcessRecovery();
      await flushBackgroundWork();
      expect(hoisted.listStaleRunningProcesses).toHaveBeenCalledTimes(2);
    });

    it("hands a dispatchable row to a fresh invocation when a self-invocation target is configured", async () => {
      hoisted.env.agentContinueSecret = "s3cret";
      hoisted.env.publicBaseUrl = "https://nova.example";
      const editor = processRow({
        id: 7,
        kind: "editor",
        attempts: 0,
        payload: { task: "y" },
      });
      hoisted.listStaleRunningProcesses.mockResolvedValueOnce([editor]);
      const fetchMock = vi.fn(async () => ({ ok: true }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const result = await reapOrphanedRunningProcesses();
        expect(result.dispatched).toBe(1);
        expect(fetchMock).toHaveBeenCalledWith(
          "https://nova.example/api/agent/process/resume",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ processId: 7 }),
          })
        );
        // The row is claimed by the fresh invocation, not by the sweep.
        expect(hoisted.claimRunningProcess).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
