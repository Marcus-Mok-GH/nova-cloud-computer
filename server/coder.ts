/** Nova's coding specialist delegate.
 *
 * The heavy lifting is done by a frontier coding model served by the editor's
 * own provider - Pollinations' unified API (https://gen.pollinations.ai),
 * whose z-ai/glm-5.3-flash is the default: a coding model with tool
 * calling and a 1M-token context (see ENV.nimCoderApiUrl / nimCoderModel). The
 * calling agent describes the coding task and supplies any existing code or
 * errors as context; the specialist either returns complete, working code the agent
 * then places into the workspace with its file tools (single-shot), or -
 * when a live sandbox is available and the model supports function
 * calling - works autonomously: it lists, reads and writes workspace
 * files, runs commands, and iterates until the task is done. */

import { errorMessage } from "@shared/_core/errors";
import { ENV } from "./_core/env";
import { E2B_WORKSPACE_DIR, type E2BSandboxLike } from "./e2b";
import {
  CONTEXT_CHAR_BUDGET,
  SUBAGENT_MAX_TOKENS,
  compactContext,
  contextChars,
  executeSubagentToolCall,
  listWorkspaceFiles,
  subagentSandboxTools,
  subagentToolArgs,
  subagentToolSummary,
} from "./subagentRuntime";
import {
  NimContextLengthError,
  NimToolsUnsupportedError,
  runNimAgentChat,
  runNimChat,
  type NimAgentMessage,
  type NimAgentTool,
} from "./nim";

const CODER_SYSTEM_PROMPT = `You are Nova's coding specialist. You write, refactor, debug, and optimize real code for Nova's users.

Rules:
- Return complete, working code - full files or full functions, never "..." placeholders or instructions to imagine the rest.
- Match the language, framework, and style the task asks for; when the task includes existing code, extend or fix it in place without gratuitous rewrites.
- Prefer clarity over cleverness. Handle the obvious edge cases; comment only what is genuinely non-obvious.
- Never assume. Inspect the relevant files, repository state, installed skills, documentation, or other reliable source before making a choice, even when uncertainty is slight. If an important ambiguity remains after checking, ask one focused question or return the smallest safe change and clearly identify what is unresolved. Never invent APIs, paths, dependencies, data, or requirements.
- You may add a brief explanation before or after the code (a few sentences at most), but the code is the deliverable: no filler, no self-description, no apologies.
- If the task is impossible as stated (contradictory requirements, missing dependency that cannot be assumed), return the closest workable version and say in one line what you changed.`;

/**
 * The autonomous specialist's operating manual. It works directly in the
 * workspace sandbox: the durable store is synced into the sandbox before it
 * starts, and anything it writes there is synced back afterwards.
 */
const AUTONOMOUS_SYSTEM_PROMPT = `You are Nova's coding specialist, working autonomously inside the user's live workspace sandbox. The workspace files live in ${E2B_WORKSPACE_DIR} - they are the user's real files. You reason, read, write and run commands entirely on your own; nobody is watching mid-task.

Tools:
- list_files: every file in the workspace (paths relative to ${E2B_WORKSPACE_DIR}).
- read_file: one file's full content.
- write_file: create or completely overwrite one file. Always send the FULL final content, never placeholders or partial diffs.
- run_command: one bash command executed in ${E2B_WORKSPACE_DIR} - install dependencies, build, run, test. Output is truncated, so keep commands focused.

How to work:
1. List the files and read whatever the task touches before changing it. Explore in parallel when you can.
2. Write complete files. Keep the existing structure, framework and style unless the task says otherwise.
3. VERIFY your work: run the code, its tests, or at least a syntax/build check with run_command. If it fails, read the error, fix the file, and check again. Iterate - do not hand over unverified code.
4. Never delete or rename workspace files with shell commands (the durable store would resurrect them); to remove content, overwrite the file, and ask for deletions explicitly in your summary.
5. Stay inside the workspace: scratch files go in /tmp, installs go in the sandbox, and write_file only accepts workspace-relative paths.
6. When everything works, stop calling tools and reply with a short plain-text summary: what you built or fixed, the files you changed, how you verified it, and anything the user should do next.

Rules:
- Complete, working code only - never "..." placeholders or instructions to imagine the rest.
- Never assume. Inspect the relevant files, repository state, installed skills, documentation, or other reliable source before making a choice, even when uncertainty is slight. If an important ambiguity remains after checking, ask one focused question or return the smallest safe change and clearly identify what is unresolved. Never invent APIs, paths, dependencies, data, or requirements.
- If the task is impossible as stated, build the closest workable version and say in one line what you changed.`;

/** The tools the autonomous specialist may call in the sandbox. */
const CODER_TOOLS: NimAgentTool[] = subagentSandboxTools({
  writeFilePathExample: "index.html",
  runCommandDescription:
    "Run one bash command in the workspace directory - install, build, run, test. Output is truncated to the first 4000 characters.",
});

/**
 * No fixed step or time cap: the specialist loops until it replies with a
 * final summary, bounded only by the caller's segment deadline (which the
 * run chains past automatically via continuations). The step cap used to
 * stop mid-task autonomous specialists with a misleading "ran out of
 * steps" message even when the run had budget left to continue.
 */
/**
 * The least time a delegated specialist call needs before the deadline to be
 * worth starting. It no longer bounds the specialist's own budget - the
 * specialist runs on the caller's full remaining segment budget - but the
 * caller still uses it to decide whether a failed specialist call is worth
 * retrying.
 */
export const MIN_CALL_RESERVE_MS = 30_000;
/** The honest outcome when a segment has no time left to start the specialist. */
const NO_START_SUMMARY =
  "The editor sub-agent could not start: this execution segment's time budget is already exhausted (it wrote 0 file(s) and ran 0 command(s)). Do not call editor again in this segment. Reply briefly that the work is continuing automatically, and end your turn - the next segment arrives with a fresh time budget and the task resumes there.";

export type CoderResult = {
  /** The specialist's complete reply: the working code plus its brief explanation. */
  code: string;
  /** The NIM model ID that produced the reply. */
  model: string;
};

/**
 * One specialist tool call, streamed to the parent agent's activity feed in
 * the same shape as the parent's own tool activities. Args carry only the
 * short identifying fields (path, command) - never the file payloads.
 */
export type CoderToolActivity = {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  args: Record<string, string>;
  summary?: string;
};

export type AutonomousCoderOptions = {
  /** The coding job, described completely. */
  task: string;
  /** Optional supporting material - existing code, exact errors, file layouts. */
  context?: string;
  /** Optional explicit target language or framework. */
  language?: string;
  /** The live workspace sandbox the specialist works in. */
  sandbox: E2BSandboxLike;
  /** Live progress notes for the user-facing activity panel. */
  onProgress?: (note: string) => void;
  /** When the overall agent run must be over. */
  deadlineAtMs?: number;
  /**
   * Streams every specialist tool call as a structured activity
   * (running → completed/failed), so the parent agent's chat shows the
   * editor's file reads, writes and commands the same way it shows its own
   * tool calls. The parent namespaces each id with its own call id.
   */
  onToolActivity?: (activity: CoderToolActivity) => void | Promise<void>;
};

export type CoderOutcome =
  | {
      kind: "autonomous";
      summary: string;
      writtenPaths: string[];
      commandsRun: number;
      rounds: number;
      model: string;
    }
  | { kind: "single"; code: string; model: string };

/**
 * Runs the coding specialist as an autonomous agent in the live workspace
 * sandbox: it lists, reads and writes workspace files and runs commands on
 * its own, iterating until it replies with a final summary. Its writes are
 * mirrored onto the sandbox (the caller syncs them back into the durable
 * store). Falls back to the single-shot reply when the model does not
 * support function calling, so the caller only needs one outcome type.
 */
export async function runAutonomousCoderTask(
  options: AutonomousCoderOptions
): Promise<CoderOutcome> {
  const trimmedTask = options.task.trim();
  if (!trimmedTask) throw new Error("A coding task is required.");

  // The specialist runs on the caller's full remaining segment budget: it
  // stops only when the run deadline itself passes, so a long task keeps
  // working instead of handing back early with time still on the clock. The
  // caller's deadline race is the hard boundary - work still in flight when
  // it fires is not lost (the writes are already in the sandbox) and the
  // continuation resumes from there. Only an already-expired budget makes the
  // task not worth starting (listing the workspace would overrun the
  // deadline), so return the honest "could not start" outcome straight away.
  const budgetEndMs = options.deadlineAtMs ?? Number.POSITIVE_INFINITY;
  if (budgetEndMs - Date.now() <= 0) {
    return {
      kind: "autonomous",
      summary: NO_START_SUMMARY,
      writtenPaths: [],
      commandsRun: 0,
      rounds: 0,
      model: ENV.nimCoderModel,
    };
  }

  const workspaceListing = await listWorkspaceFiles(options.sandbox);
  const intro: string[] = [];
  if (options.language?.trim())
    intro.push(`Target language/framework: ${options.language.trim()}`);
  intro.push(`Coding task:\n\n${trimmedTask}`);
  if (options.context?.trim())
    intro.push(
      `Existing code, errors, and other context:\n\n${options.context.trim()}`
    );
  intro.push(
    `The workspace currently holds these files (paths relative to ${E2B_WORKSPACE_DIR}):\n\n${workspaceListing.result}`
  );

  const messages: NimAgentMessage[] = [
    { role: "system", content: AUTONOMOUS_SYSTEM_PROMPT },
    { role: "user", content: intro.join("\n\n") },
  ];
  const writtenPaths = new Set<string>();
  let commandsRun = 0;
  // No time cap of its own: with a deadline the specialist uses the full
  // remaining segment budget; without one it runs until the final summary,
  // however long that takes.
  let roundsRun = 0;

  while (true) {
    const remainingMs = budgetEndMs - Date.now();
    if (remainingMs <= 0) break;
    const round = roundsRun;
    roundsRun += 1;
    // Keep the request inside the model's window before it is refused: once
    // the history passes the budget, compact the older payloads now rather
    // than waiting for the context-length rejection.
    if (contextChars(messages) > CONTEXT_CHAR_BUDGET) {
      compactContext(messages);
    }
    let reply;
    try {
      reply = await runNimAgentChat({
        messages,
        tools: CODER_TOOLS,
        model: ENV.nimCoderModel,
        apiUrl: ENV.nimCoderApiUrl,
        apiKey: ENV.nimCoderApiKey,
        maxTokens: SUBAGENT_MAX_TOKENS,
        // The call may use whatever budget is left; the loop above stops it
        // once the segment deadline passes.
        timeoutMs: Math.min(240_000, remainingMs),
        // Hard-stop attempts and retries at the deadline: a timed-out
        // request's second chance (or a backoff retry) must not run past the
        // run deadline, where the caller's race would interrupt it.
        deadlineAtMs: budgetEndMs,
      });
    } catch (error) {
      // The history outgrew the model's context window. Compact it hard and
      // retry the same round - the specialist keeps its place and the files
      // it already wrote - instead of ending the task on a limit that is
      // perfectly recoverable. Only when nothing more can be freed is the
      // honest, actionable summary below returned.
      if (error instanceof NimContextLengthError) {
        const freed = compactContext(messages, { aggressive: true });
        if (freed && budgetEndMs - Date.now() >= MIN_CALL_RESERVE_MS) {
          options.onProgress?.(
            "The task outgrew the model's context window - compacting earlier steps and continuing…"
          );
          continue;
        }
        // Compaction worked but the segment has no time left to retry: that is
        // a budget stop, not a compaction failure. Only a compaction that freed
        // nothing is the unrecoverable case, so report each honestly.
        const summary = freed
          ? `The specialist's conversation outgrew the model's context window; it compacted the earlier steps but this segment ran out of time before it could retry. It wrote ${writtenPaths.size} file(s) and ran ${commandsRun} command(s). The run continues automatically in the next segment with a fresh time budget; verify the changed files it wrote and decide whether to delegate the remaining work again there.`
          : `The specialist's conversation grew past the model's context window and could no longer be compacted. It wrote ${writtenPaths.size} file(s) and ran ${commandsRun} command(s) before stopping. Verify the changed files it wrote, then delegate the remaining work as a fresh, smaller task so the specialist can start with a clean context.`;
        return {
          kind: "autonomous",
          summary,
          writtenPaths: Array.from(writtenPaths).sort(),
          commandsRun,
          rounds: roundsRun,
          model: ENV.nimCoderModel,
        };
      }
      // Some NIM-served models do not implement function calling: the
      // first request is rejected, and the task degrades to the classic
      // single-shot reply instead of failing the whole run.
      if (error instanceof NimToolsUnsupportedError && round === 0) {
        // Pass the run deadline straight through: the single-shot path uses
        // the same full remaining budget.
        const single = await runCoderTask(
          trimmedTask,
          options.context,
          options.language,
          options.deadlineAtMs
        );
        return { kind: "single", ...single };
      }
      // Once the specialist has touched the workspace, a retry would
      // restart from a misleading clean slate (its writes are real, in the
      // sandbox). Report exactly what was done and let the caller verify.
      if (writtenPaths.size > 0 || commandsRun > 0) {
        return {
          kind: "autonomous",
          summary: `The specialist hit a failure mid-task after doing part of the work (${errorMessage(
            error,
            "unknown error"
          )}). It wrote ${writtenPaths.size} file(s) and ran ${commandsRun} command(s). Verify the changed files, finish or fix the task, and present the result honestly.`,
          writtenPaths: Array.from(writtenPaths).sort(),
          commandsRun,
          // roundsRun counts every attempted request (the zero-based
          // round index would underreport by one).
          rounds: roundsRun,
          model: ENV.nimCoderModel,
        };
      }
      throw error;
    }
    // Kimi's thinking (max reasoning is requested for reasoning-capable
    // models) streams into the caller's progress notes so the user can watch
    // the specialist reason inside the editor tool's panel, like its file writes
    // and commands.
    if (reply.reasoning) {
      const flat = reply.reasoning.replace(/\s+/g, " ").trim();
      options.onProgress?.(
        `Thinking: ${flat.slice(0, 300)}${flat.length > 300 ? "…" : ""}`
      );
    }
    if (reply.kind === "text") {
      return {
        kind: "autonomous",
        summary: reply.text,
        writtenPaths: Array.from(writtenPaths).sort(),
        commandsRun,
        rounds: roundsRun,
        model: ENV.nimCoderModel,
      };
    }
    messages.push({
      role: "assistant",
      content: reply.text || undefined,
      tool_calls: reply.toolCalls.map(call => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    for (const call of reply.toolCalls) {
      const remainingForTool = budgetEndMs - Date.now();
      // Stream the call as a first-class activity: running now, settled with
      // its real outcome below. Failed calls (non-zero exit, unsafe path,
      // rejected command) show up failed, exactly like the parent agent's
      // own tool rows. An emit failure must never break the specialist.
      const args = subagentToolArgs(call.name, call.arguments);
      const emitActivity = async (
        state: CoderToolActivity["state"],
        summary?: string
      ) => {
        if (!options.onToolActivity) return;
        try {
          await options.onToolActivity({
            id: call.id,
            name: call.name,
            state,
            args,
            ...(summary !== undefined ? { summary } : {}),
          });
        } catch {}
      };
      // The segment deadline can pass between the model round and the tool
      // calls it returned. Do not start a call then: a command or file write
      // would keep running after the caller has closed the segment, and its
      // side effects would land outside the budget that produced them.
      if (remainingForTool <= 0) {
        await emitActivity(
          "failed",
          "Skipped - the segment ran out of time before this call could start."
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "The segment ran out of time before this call could start, so it was not executed. Do not assume its result.",
        });
        continue;
      }
      await emitActivity("running");
      let execution: { ok: boolean; result: string };
      try {
        execution = await executeSubagentToolCall(
          options.sandbox,
          call.name,
          call.arguments,
          writtenPaths,
          remainingForTool
        );
      } catch (error) {
        execution = {
          ok: false,
          result: `The tool call failed: ${errorMessage(error, "unknown error")}`,
        };
      }
      if (call.name === "run_command") commandsRun += 1;
      await emitActivity(
        execution.ok ? "completed" : "failed",
        subagentToolSummary(call.name, args, execution.ok)
      );
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: execution.result,
      });
    }
  }

  // The segment budget ran out before a final summary: report exactly what
  // was done so the calling agent can verify and finish the story. There is
  // no step cap any more, so this branch is purely about time - and when the
  // specialist never even started (the main agent delegated with the segment
  // already nearly over), say that plainly instead of implying it tried and
  // failed: the automatic continuation will retry with a fresh budget.
  if (roundsRun === 0) {
    return {
      kind: "autonomous",
      summary: NO_START_SUMMARY,
      writtenPaths: [],
      commandsRun: 0,
      rounds: 0,
      model: ENV.nimCoderModel,
    };
  }
  return {
    kind: "autonomous",
    summary: `The specialist used this segment's full time budget before writing a final summary (${
      roundsRun
    } round(s)). It wrote ${
      writtenPaths.size
    } file(s) and ran ${commandsRun} command(s). The run continues automatically in the next segment with a fresh time budget; verify the changed files it wrote and decide whether to delegate the remaining work again there.`,
    writtenPaths: Array.from(writtenPaths).sort(),
    commandsRun,
    rounds: roundsRun,
    model: ENV.nimCoderModel,
  };
}

/**
 * Delegates one coding task to the specialist and returns its complete
 * reply. @param task The coding job, described completely: goal, language,
 * constraints, what "done" means. @param context Optional supporting
 * material - existing code, the exact error output, file or API layouts. @param language Optional explicit target language or framework. Rejects when
 * the task is empty or the editor's model endpoint is not configured (the
 * operator must set POLLINATIONS_API_KEY, or the NVIDIA_NIM_CODER_API_KEY
 * override).
 */
export async function runCoderTask(
  task: string,
  context?: string,
  language?: string,
  /** Absolute epoch-ms deadline the model request must return before. */
  deadlineAtMs?: number
): Promise<CoderResult> {
  const trimmedTask = task.trim();
  if (!trimmedTask) throw new Error("A coding task is required.");

  const parts: string[] = [];
  if (language?.trim())
    parts.push(`Target language/framework: ${language.trim()}`);
  parts.push(`Coding task:\n\n${trimmedTask}`);
  if (context?.trim())
    parts.push(
      `Existing code, errors, and other context:\n\n${context.trim()}`
    );
  // The caller's deadline is passed straight through: the specialist uses the
  // full remaining segment budget, and the caller's own deadline race bounds
  // the call.
  const code = await runNimChat({
    prompt: parts.join("\n\n"),
    systemPrompt: CODER_SYSTEM_PROMPT,
    model: ENV.nimCoderModel,
    apiUrl: ENV.nimCoderApiUrl,
    apiKey: ENV.nimCoderApiKey,
    maxTokens: SUBAGENT_MAX_TOKENS,
    ...(deadlineAtMs !== undefined ? { deadlineAtMs } : {}),
  });
  return { code: code.trim(), model: ENV.nimCoderModel };
}
