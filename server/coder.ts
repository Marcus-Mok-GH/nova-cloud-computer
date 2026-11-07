/** Nova's coding specialist delegate.
 *
 * The heavy lifting is done by the same model Nova's built-in gateway runs
 * on, served to the editor through Pollinations' unified API
 * (https://gen.pollinations.ai): the editor's default model id is
 * openai/gpt-6-luna, with tool calling and a 1M-token context (see
 * ENV.nimCoderApiUrl / nimCoderModel). The
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
  // No time cap of any kind: the specialist runs until the final summary,
  // however long that takes.
  let roundsRun = 0;

  while (true) {
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
        // Unbounded: the specialist is never on a clock - a request runs
        // until the model answers, however long that takes.
        timeoutMs: Number.POSITIVE_INFINITY,
      });
    } catch (error) {
      // The history outgrew the model's context window. Compact it hard and
      // retry the same round - the specialist keeps its place and the files
      // it already wrote - instead of ending the task on a limit that is
      // perfectly recoverable. Only when nothing more can be freed is the
      // honest, actionable summary below returned.
      if (error instanceof NimContextLengthError) {
        const freed = compactContext(messages, { aggressive: true });
        if (freed) {
          options.onProgress?.(
            "The task outgrew the model's context window - compacting earlier steps and continuing…"
          );
          continue;
        }
        // Only a compaction that freed nothing is the unrecoverable case.
        const summary = `The specialist's conversation grew past the model's context window and could no longer be compacted. It wrote ${writtenPaths.size} file(s) and ran ${commandsRun} command(s) before stopping. Verify the changed files it wrote, then delegate the remaining work as a fresh, smaller task so the specialist can start with a clean context.`;
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
        const single = await runCoderTask(
          trimmedTask,
          options.context,
          options.language
        );
        return { kind: "single", ...single };
      }
      // Once the specialist has touched the workspace, a retry would
      // restart from a misleading clean slate (its writes are real, in the
      // sandbox). Report exactly what was done and let the caller verify.
      if (writtenPaths.size > 0 || commandsRun > 0) {
        const reason = errorMessage(error, "unknown error");
        return {
          kind: "autonomous",
          summary: `The specialist hit a failure mid-task after doing part of the work (${reason}). It wrote ${writtenPaths.size} file(s) and ran ${commandsRun} command(s). Verify the changed files, finish or fix the task, and present the result honestly.`,
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
      await emitActivity("running");
      let execution: { ok: boolean; result: string };
      try {
        // The per-command default in executeSubagentToolCall (not a budget)
        // bounds one command, so a hung install or build cannot wedge the
        // specialist forever.
        execution = await executeSubagentToolCall(
          options.sandbox,
          call.name,
          call.arguments,
          writtenPaths
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

  // Unreachable: the loop above only exits by returning its outcome (a
  // final summary, a degraded single-shot reply, or an honest failure
  // report). TypeScript still wants a path out.
  throw new Error("unreachable");
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
  language?: string
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
  const code = await runNimChat({
    prompt: parts.join("\n\n"),
    systemPrompt: CODER_SYSTEM_PROMPT,
    model: ENV.nimCoderModel,
    apiUrl: ENV.nimCoderApiUrl,
    apiKey: ENV.nimCoderApiKey,
    maxTokens: SUBAGENT_MAX_TOKENS,
    // Unbounded: the specialist is never on a clock.
    timeoutMs: Number.POSITIVE_INFINITY,
  });
  return { code: code.trim(), model: ENV.nimCoderModel };
}
