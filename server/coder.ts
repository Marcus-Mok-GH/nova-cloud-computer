/** Nova's coding specialist delegate.
 *
 * The heavy lifting is done by a frontier coding model served by the editor's
 * own provider - Pollinations' unified API (https://gen.pollinations.ai),
 * whose deepseek/deepseek-v4.1-flash is the default: a coding model with tool
 * calling and a 1M-token context (see ENV.nimCoderApiUrl / nimCoderModel). The
 * calling agent describes the coding task and supplies any existing code or
 * errors as context; the specialist either returns complete, working code the agent
 * then places into the workspace with its file tools (single-shot), or -
 * when a live sandbox is available and the model supports function
 * calling - works autonomously: it lists, reads and writes workspace
 * files, runs commands, and iterates until the task is done. */

import { ENV } from "./_core/env";
import { E2B_WORKSPACE_DIR, type E2BSandboxLike } from "./e2b";
import { mirrorWorkspaceOp } from "./sandboxWorkspace";
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
const CODER_TOOLS: NimAgentTool[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: `List every file in the workspace, as paths relative to ${E2B_WORKSPACE_DIR}.`,
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read one workspace file's full content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path, e.g. 'src/main.py'.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or completely overwrite one workspace file with its full final content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path, e.g. 'index.html'.",
          },
          content: {
            type: "string",
            description:
              "The complete final content of the file - never partial or placeholder text.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run one bash command in the workspace directory - install, build, run, test. Output is truncated to the first 4000 characters.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "The bash command to run, e.g. 'python3 game.py --self-check' or 'npm install && npm test'.",
          },
        },
        required: ["command"],
      },
    },
  },
];

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
const READ_LIMIT = 16_000;
const COMMAND_OUTPUT_LIMIT = 4_000;
const COMMAND_TIMEOUT_MS = 120_000;
/**
 * The specialist's conversation grows by a full tool result every round - a
 * file read can be 16k characters and a command's output 4k - so a long
 * autonomous task eventually pushes the request past the model's context
 * window and the call is refused. The conversation is compacted before it
 * gets there: what matters for the remaining work is the recent exchange and
 * the files already written, not the byte payloads of every earlier read, so
 * the oldest tool results collapse to a short stub. The assistant tool_call
 * to tool-result pairing and every call's id are preserved, keeping the
 * conversation valid for the model while the window stops filling up. This is
 * what lets a long task finish instead of dying at the context limit.
 */
const CONTEXT_CHAR_BUDGET = 300_000;
/**
 * Output-token cap for one specialist round. The file content in a write_file
 * call counts as output, so a small cap truncates a large file into malformed
 * JSON and fails the write; 16384 comfortably covers the files this workspace
 * handles while staying well inside what NIM-served coding models emit.
 */
const SPECIALIST_MAX_TOKENS = 16_384;
const CONTEXT_KEEP_RECENT_MESSAGES = 8;
const CONTEXT_RECENT_TOOL_CAP = 12_000;
const CONTEXT_ASSISTANT_CAP = 4_000;
const CONTEXT_OLD_TOOL_STUB =
  "(earlier tool output omitted to stay within the model's context window)";

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

/** A workspace-relative path, or null when it is not safe to touch. */
function safeWorkspacePath(value: string): string | null {
  const parts = value
    .replace(/\\/g, "/")
    .split("/")
    .filter(part => part && part !== ".");
  if (parts.some(part => part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(truncated)`;
}

/** Approximate size of the specialist's conversation, in characters. */
function coderContextChars(messages: NimAgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (message.role === "tool") total += message.content.length;
    else if (message.role === "assistant") {
      total += message.content?.length ?? 0;
      for (const call of message.tool_calls ?? [])
        total += call.function.arguments.length;
    } else total += message.content.length;
  }
  return total;
}

/**
 * Shrinks the specialist's conversation toward the context budget without
 * breaking it. Messages up to and including the first user turn (the system
 * prompt and the task intro) are never touched: they are the anchor the model
 * needs to stay on task. Older tool results become a stub, the most recent
 * ones are capped, and long interim assistant text is trimmed - the
 * assistant's tool_calls are always kept intact, so every tool result still
 * follows the call it answers. Returns true when anything changed, so callers
 * can tell whether compaction can free more before giving up.
 */
function compactCoderContext(
  messages: NimAgentMessage[],
  options?: { aggressive?: boolean }
): boolean {
  const aggressive = options?.aggressive ?? false;
  const firstUser = messages.findIndex(message => message.role === "user");
  if (firstUser < 0) return false;
  const keepRecent = aggressive ? 4 : CONTEXT_KEEP_RECENT_MESSAGES;
  const recentStart = Math.max(firstUser + 1, messages.length - keepRecent);
  const toolCap = aggressive ? 2_000 : CONTEXT_RECENT_TOOL_CAP;
  const assistantCap = aggressive ? 500 : CONTEXT_ASSISTANT_CAP;
  let changed = false;
  for (let index = firstUser + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "tool") {
      if (index < recentStart) {
        if (message.content !== CONTEXT_OLD_TOOL_STUB) {
          messages[index] = { ...message, content: CONTEXT_OLD_TOOL_STUB };
          changed = true;
        }
      } else if (message.content.length > toolCap) {
        const capped = truncate(message.content, toolCap);
        // truncate appends a suffix, so compare the result: re-capping an
        // already-shortened message must not read as progress, or the caller
        // would retry the same over-long request forever.
        if (capped !== message.content) {
          messages[index] = { ...message, content: capped };
          changed = true;
        }
      }
    } else if (message.role === "assistant") {
      let next = message;
      if (message.content && message.content.length > assistantCap) {
        const capped = truncate(message.content, assistantCap);
        if (capped !== message.content) {
          next = { ...next, content: capped };
          changed = true;
        }
      }
      // An old exchange keeps the file payloads of its write_file calls in the
      // tool-call arguments, and those can dwarf the results themselves. Once
      // the exchange is old its arguments are no longer needed, so replace
      // them with an empty object - still valid JSON, matched by the stubbed
      // tool result - or a task that repeatedly writes large files would keep
      // the window pinned open no matter how its text is trimmed. The recent
      // calls keep their arguments intact.
      if (index < recentStart && next.tool_calls?.length) {
        let shrank = false;
        const toolCalls = next.tool_calls.map(call => {
          if (call.function.arguments === "{}") return call;
          shrank = true;
          return { ...call, function: { ...call.function, arguments: "{}" } };
        });
        if (shrank) {
          next = { ...next, tool_calls: toolCalls };
          changed = true;
        }
      }
      if (next !== message) messages[index] = next;
    }
  }
  return changed;
}

async function runSandboxCommand(
  sandbox: E2BSandboxLike,
  command: string,
  remainingMs: number
): Promise<{ ok: boolean; result: string }> {
  const timeoutMs = Math.min(COMMAND_TIMEOUT_MS, Math.max(10_000, remainingMs));
  const result = await sandbox.commands.run(
    `cd ${E2B_WORKSPACE_DIR} && (${command})`,
    { timeoutMs }
  );
  const stdout = String((result as { stdout?: unknown }).stdout ?? "");
  const stderr = String((result as { stderr?: unknown }).stderr ?? "");
  const exitCode = (result as { exitCode?: unknown }).exitCode ?? 0;
  const parts: string[] = [];
  if (stdout.trim()) parts.push(truncate(stdout, COMMAND_OUTPUT_LIMIT));
  if (stderr.trim())
    parts.push(`[stderr]\n${truncate(stderr, COMMAND_OUTPUT_LIMIT)}`);
  parts.push(`[exit code ${exitCode}]`);
  return {
    ok: exitCode === 0,
    result: parts.join("\n") || "(no output)",
  };
}

/**
 * Lists the workspace files for the specialist's intro prompt and the
 * list_files tool. Failures stay failures: a thrown command or a non-zero
 * exit must not read as a successful empty listing, or the specialist (and
 * the user's activity feed) would believe the workspace is empty.
 */
async function listWorkspaceFiles(
  sandbox: E2BSandboxLike
): Promise<{ ok: boolean; result: string }> {
  try {
    const result = await sandbox.commands.run(
      `cd ${E2B_WORKSPACE_DIR} && find . -type f -not -path './.git/*' | sort | head -200`,
      { timeoutMs: 15_000 }
    );
    const exitCode = (result as { exitCode?: unknown }).exitCode ?? 0;
    if (exitCode !== 0)
      return {
        ok: false,
        result: `(could not list the workspace: exit code ${exitCode})`,
      };
    const listing = String((result as { stdout?: unknown }).stdout ?? "")
      .split("\n")
      .map(line => line.trim().replace(/^\.\//, ""))
      .filter(Boolean);
    return {
      ok: true,
      result:
        listing.length > 0 ? listing.join("\n") : "(the workspace is empty)",
    };
  } catch {
    return { ok: false, result: "(could not list the workspace)" };
  }
}

/** The short identifying args a specialist activity carries (no payloads). */
function specialistToolArgs(
  name: string,
  rawArguments: string
): Record<string, string> {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      args = parsed as Record<string, unknown>;
  } catch {
    // Truncated or malformed JSON - the label falls back to the tool name.
  }
  const s = (value: unknown) => (typeof value === "string" ? value : "");
  if (name === "read_file" || name === "write_file")
    return args.path ? { path: s(args.path) } : {};
  if (name === "run_command")
    return args.command ? { command: s(args.command) } : {};
  return {};
}

/** One-line summary of a settled specialist tool call. */
function specialistToolSummary(
  name: string,
  args: Record<string, string>,
  ok: boolean
): string {
  const brief = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;
  switch (name) {
    case "list_files":
      return ok
        ? "Listed the workspace files."
        : "Could not list the workspace files.";
    case "read_file":
      return ok ? `Read ${args.path}.` : `Could not read ${args.path}.`;
    case "write_file":
      return ok ? `Wrote ${args.path}.` : `Could not write ${args.path}.`;
    case "run_command":
      return `${ok ? "Ran" : "Command failed"}: ${brief(args.command ?? "", 80)}`;
    default:
      return ok ? "Completed." : "Failed.";
  }
}

/** Executes one specialist tool call, returning its ok flag and result text. */
async function executeCoderToolCall(
  sandbox: E2BSandboxLike,
  name: string,
  rawArguments: string,
  writtenPaths: Set<string>,
  remainingMs = COMMAND_TIMEOUT_MS
): Promise<{ ok: boolean; result: string }> {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      args = parsed as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      result: "Invalid JSON arguments - call the tool again with valid JSON.",
    };
  }
  const str = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  // File content is the one argument that must survive byte-exact: leading
  // indentation, trailing newlines and inner whitespace are all meaningful.
  const raw = (value: unknown) => (typeof value === "string" ? value : "");
  switch (name) {
    case "list_files":
      return await listWorkspaceFiles(sandbox);
    case "read_file": {
      const path = safeWorkspacePath(str(args.path));
      if (!path) return { ok: false, result: `Unsafe path: ${str(args.path)}` };
      try {
        const content = await sandbox.files.read(
          `${E2B_WORKSPACE_DIR}/${path}`,
          { format: "text" }
        );
        const text =
          typeof content === "string"
            ? content
            : Buffer.from(content as Uint8Array).toString("utf8");
        return {
          ok: true,
          result:
            text.length > 0
              ? truncate(text, READ_LIMIT)
              : "(the file is empty)",
        };
      } catch {
        return {
          ok: false,
          result: `Could not read ${path} - it may not exist. Use list_files first.`,
        };
      }
    }
    case "write_file": {
      const path = safeWorkspacePath(str(args.path));
      const content = raw(args.content);
      if (!path) return { ok: false, result: `Unsafe path: ${str(args.path)}` };
      if (!content)
        return {
          ok: false,
          result: "write_file needs the file's full content.",
        };
      const mirrored = await mirrorWorkspaceOp(sandbox, {
        kind: "write_file",
        path,
        content,
      });
      if (!mirrored.ok)
        return {
          ok: false,
          result: `Could not write ${path}: ${mirrored.error}`,
        };
      writtenPaths.add(path);
      return {
        ok: true,
        result: `Wrote ${path} (${content.length} characters).`,
      };
    }
    case "run_command": {
      const command = str(args.command);
      if (!command)
        return { ok: false, result: "run_command needs a command." };
      // The durable store only ever imports sandbox files - it never
      // deletes - so a shell delete or rename would diverge from it and
      // the file would resurrect on the next run. The system prompt asks
      // the model not to; this boundary check makes it stick for the
      // common cases (rm, mv, unlink, rmdir, shred, and the git
      // equivalents). Anything else destructive is the prompt's job.
      const forbidden =
        /(^|[;&|\s])(rm|rmdir|unlink|shred)\b|(^|[;&|\s])mv\b|git\s+(rm|clean)\b/.test(
          command
        );
      if (forbidden) {
        return {
          ok: false,
          result:
            "Rejected: this workspace must not delete or rename files with shell " +
            "commands (the durable store would resurrect them). To replace content, " +
            "use write_file with the full new content; to move a file, write_file " +
            "the new path and ask Nova to remove the old one afterwards.",
        };
      }
      try {
        return await runSandboxCommand(sandbox, command, remainingMs);
      } catch (error) {
        return {
          ok: false,
          result: `The command failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        };
      }
    }
    default:
      return { ok: false, result: `Unknown tool: ${name}` };
  }
}

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
    if (coderContextChars(messages) > CONTEXT_CHAR_BUDGET) {
      compactCoderContext(messages);
    }
    let reply;
    try {
      reply = await runNimAgentChat({
        messages,
        tools: CODER_TOOLS,
        model: ENV.nimCoderModel,
        apiUrl: ENV.nimCoderApiUrl,
        apiKey: ENV.nimCoderApiKey,
        maxTokens: SPECIALIST_MAX_TOKENS,
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
        const freed = compactCoderContext(messages, { aggressive: true });
        if (freed && budgetEndMs - Date.now() >= MIN_CALL_RESERVE_MS) {
          options.onProgress?.(
            "The task outgrew the model's context window - compacting earlier steps and continuing…"
          );
          continue;
        }
        return {
          kind: "autonomous",
          summary:
            `The specialist's conversation grew past the model's context window and could no longer be compacted. ` +
            `It wrote ${writtenPaths.size} file(s) and ran ${commandsRun} command(s) before stopping. ` +
            `Verify the changed files it wrote, then delegate the remaining work as a fresh, smaller task so the specialist can start with a clean context.`,
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
          summary: `The specialist hit a failure mid-task after doing part of the work (${
            error instanceof Error ? error.message : "unknown error"
          }). It wrote ${writtenPaths.size} file(s) and ran ${commandsRun} command(s). Verify the changed files, finish or fix the task, and present the result honestly.`,
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
      const args = specialistToolArgs(call.name, call.arguments);
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
        execution = await executeCoderToolCall(
          options.sandbox,
          call.name,
          call.arguments,
          writtenPaths,
          remainingForTool
        );
      } catch (error) {
        execution = {
          ok: false,
          result: `The tool call failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        };
      }
      if (call.name === "run_command") commandsRun += 1;
      await emitActivity(
        execution.ok ? "completed" : "failed",
        specialistToolSummary(call.name, args, execution.ok)
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
    maxTokens: SPECIALIST_MAX_TOKENS,
    ...(deadlineAtMs !== undefined ? { deadlineAtMs } : {}),
  });
  return { code: code.trim(), model: ENV.nimCoderModel };
}
