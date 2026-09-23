/** Nova's coding specialist delegate.
 *
 * The heavy lifting is done by the strongest coding model served through
 * NVIDIA NIM (https://build.nvidia.com) - Kimi K3 by default, a
 * frontier coding MoE with a 262K-token context. The calling agent
 * describes the coding task and supplies any existing code or errors as
 * context; the specialist either returns complete, working code the agent
 * then places into the workspace with its file tools (single-shot), or -
 * when a live sandbox is available and the model supports function
 * calling - works autonomously: it lists, reads and writes workspace
 * files, runs commands, and iterates until the task is done. */

import { ENV } from "./_core/env";
import { E2B_WORKSPACE_DIR, type E2BSandboxLike } from "./e2b";
import { mirrorWorkspaceOp } from "./sandboxWorkspace";
import {
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
      description: "Create or completely overwrite one workspace file with its full final content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path, e.g. 'index.html'.",
          },
          content: {
            type: "string",
            description: "The complete final content of the file - never partial or placeholder text.",
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
      description: "Run one bash command in the workspace directory - install, build, run, test. Output is truncated to the first 4000 characters.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to run, e.g. 'python3 game.py --self-check' or 'npm install && npm test'.",
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
/** Never start a model call that cannot finish before the deadline. */
const MIN_CALL_RESERVE_MS = 30_000;
const READ_LIMIT = 16_000;
const COMMAND_OUTPUT_LIMIT = 4_000;
const COMMAND_TIMEOUT_MS = 120_000;

export type CoderResult = {
  /** The specialist's complete reply: the working code plus its brief explanation. */
  code: string;
  /** The NIM model ID that produced the reply. */
  model: string;
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

async function runSandboxCommand(
  sandbox: E2BSandboxLike,
  command: string,
  remainingMs: number
): Promise<string> {
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
  if (stderr.trim()) parts.push(`[stderr]\n${truncate(stderr, COMMAND_OUTPUT_LIMIT)}`);
  parts.push(`[exit code ${exitCode}]`);
  return parts.join("\n") || "(no output)";
}

async function listWorkspaceFiles(
  sandbox: E2BSandboxLike
): Promise<string> {
  try {
    const result = await sandbox.commands.run(
      `cd ${E2B_WORKSPACE_DIR} && find . -type f -not -path './.git/*' | sort | head -200`,
      { timeoutMs: 15_000 }
    );
    const listing = String((result as { stdout?: unknown }).stdout ?? "")
      .split("\n")
      .map(line => line.trim().replace(/^\.\//, ""))
      .filter(Boolean);
    return listing.length > 0
      ? listing.join("\n")
      : "(the workspace is empty)";
  } catch {
    return "(could not list the workspace)";
  }
}

/** Executes one specialist tool call and returns its result text. */
async function executeCoderToolCall(
  sandbox: E2BSandboxLike,
  name: string,
  rawArguments: string,
  writtenPaths: Set<string>,
  onProgress?: (note: string) => void,
  remainingMs = COMMAND_TIMEOUT_MS
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      args = parsed as Record<string, unknown>;
  } catch {
    return "Invalid JSON arguments - call the tool again with valid JSON.";
  }
  const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  // File content is the one argument that must survive byte-exact: leading
  // indentation, trailing newlines and inner whitespace are all meaningful.
  const raw = (value: unknown) => (typeof value === "string" ? value : "");
  switch (name) {
    case "list_files": {
      onProgress?.("The specialist is listing the workspace files…");
      return await listWorkspaceFiles(sandbox);
    }
    case "read_file": {
      const path = safeWorkspacePath(str(args.path));
      if (!path) return `Unsafe path: ${str(args.path)}`;
      try {
        const content = await sandbox.files.read(
          `${E2B_WORKSPACE_DIR}/${path}`,
          { format: "text" }
        );
        const text =
          typeof content === "string"
            ? content
            : Buffer.from(content as Uint8Array).toString("utf8");
        onProgress?.(`The specialist is reading ${path}…`);
        return text.length > 0
          ? truncate(text, READ_LIMIT)
          : "(the file is empty)";
      } catch {
        return `Could not read ${path} - it may not exist. Use list_files first.`;
      }
    }
    case "write_file": {
      const path = safeWorkspacePath(str(args.path));
      const content = raw(args.content);
      if (!path) return `Unsafe path: ${str(args.path)}`;
      if (!content) return "write_file needs the file's full content.";
      const mirrored = await mirrorWorkspaceOp(sandbox, {
        kind: "write_file",
        path,
        content,
      });
      if (!mirrored.ok) return `Could not write ${path}: ${mirrored.error}`;
      writtenPaths.add(path);
      onProgress?.(`The specialist wrote ${path}…`);
      return `Wrote ${path} (${content.length} characters).`;
    }
    case "run_command": {
      const command = str(args.command);
      if (!command) return "run_command needs a command.";
      // The durable store only ever imports sandbox files - it never
      // deletes - so a shell delete or rename would diverge from it and
      // the file would resurrect on the next run. The system prompt asks
      // the model not to; this boundary check makes it stick for the
      // common cases (rm, mv, unlink, rmdir, shred, and the git
      // equivalents). Anything else destructive is the prompt's job.
      const forbidden = /(^|[;&|\s])(rm|rmdir|unlink|shred)\b|(^|[;&|\s])mv\b|git\s+(rm|clean)\b/.test(
        command
      );
      if (forbidden) {
        return (
          "Rejected: this workspace must not delete or rename files with shell " +
          "commands (the durable store would resurrect them). To replace content, " +
          "use write_file with the full new content; to move a file, write_file " +
          "the new path and ask Nova to remove the old one afterwards."
        );
      }
      onProgress?.(`The specialist is running: ${command.slice(0, 80)}`);
      try {
        return await runSandboxCommand(sandbox, command, remainingMs);
      } catch (error) {
        return `The command failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
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

  const listing = await listWorkspaceFiles(options.sandbox);
  const intro: string[] = [];
  if (options.language?.trim())
    intro.push(`Target language/framework: ${options.language.trim()}`);
  intro.push(`Coding task:\n\n${trimmedTask}`);
  if (options.context?.trim())
    intro.push(`Existing code, errors, and other context:\n\n${options.context.trim()}`);
  intro.push(
    `The workspace currently holds these files (paths relative to ${E2B_WORKSPACE_DIR}):\n\n${listing}`
  );

  const messages: NimAgentMessage[] = [
    { role: "system", content: AUTONOMOUS_SYSTEM_PROMPT },
    { role: "user", content: intro.join("\n\n") },
  ];
  const writtenPaths = new Set<string>();
  let commandsRun = 0;
  // No time cap of its own: with a deadline the specialist uses the full
  // remaining segment budget (minus the reserve the final summary needs);
  // without one it runs until the final summary, however long that takes.
  const budgetEndMs =
    options.deadlineAtMs !== undefined
      ? options.deadlineAtMs - MIN_CALL_RESERVE_MS
      : Number.POSITIVE_INFINITY;
  let roundsRun = 0;

  while (true) {
    const remainingMs = budgetEndMs - Date.now();
    if (remainingMs < MIN_CALL_RESERVE_MS) break;
    const round = roundsRun;
    roundsRun += 1;
    let reply;
    try {
      reply = await runNimAgentChat({
        messages,
        tools: CODER_TOOLS,
        maxTokens: 8192,
        timeoutMs: Math.min(240_000, Math.max(30_000, remainingMs - 15_000)),
      });
    } catch (error) {
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
    // the specialist reason inside the code_task panel, like its file writes
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
      const result = await executeCoderToolCall(
        options.sandbox,
        call.name,
        call.arguments,
        writtenPaths,
        options.onProgress,
        remainingForTool
      );
      if (call.name === "run_command") commandsRun += 1;
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
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
      summary:
        "The coding specialist could not start: this execution segment's time budget is already exhausted (it wrote 0 file(s) and ran 0 command(s)). Do not call code_task again in this segment. Reply briefly that the work is continuing automatically, and end your turn - the next segment arrives with a fresh time budget and the task resumes there.",
      writtenPaths: [],
      commandsRun: 0,
      rounds: 0,
      model: ENV.nimCoderModel,
    };
  }
  return {
    kind: "autonomous",
    summary:
      `The specialist used this segment's full time budget before writing a final summary (${
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
 * the task is empty or NVIDIA NIM is not configured (the operator must set
 * NVIDIA_NIM_API_KEY).
 */
export async function runCoderTask(
  task: string,
  context?: string,
  language?: string,
): Promise<CoderResult> {
  const trimmedTask = task.trim();
  if (!trimmedTask) throw new Error("A coding task is required.");

  const parts: string[] = [];
  if (language?.trim()) parts.push(`Target language/framework: ${language.trim()}`);
  parts.push(`Coding task:\n\n${trimmedTask}`);
  if (context?.trim()) parts.push(`Existing code, errors, and other context:\n\n${context.trim()}`);
  const code = await runNimChat({ prompt: parts.join("\n\n"), systemPrompt: CODER_SYSTEM_PROMPT });
  return { code: code.trim(), model: ENV.nimCoderModel };
}
