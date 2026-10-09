/**
 * Nova's "prepare the next turn" subagent.
 *
 * After every completed agent run that actually touched the workspace, a
 * subagent spins up with Nova's /init prompt (opencode's /init, rebranded to
 * Nova) and works autonomously in the live workspace sandbox: it explores the
 * repo as the /init prompt directs and creates or improves AGENTS.md so the
 * project carries a compact instruction file for future Nova sessions.
 *
 * The user just sees a single `preparing_next_turn` activity running while the
 * subagent works, settling to completed (or failed) when it is done.
 */

import { E2B_WORKSPACE_DIR, type E2BSandboxLike } from "./e2b";
import { mirrorWorkspaceOp, syncAgentSandbox } from "./sandboxWorkspace";
import {
  NimContextLengthError,
  runNimAgentChat,
  type NimAgentMessage,
  type NimAgentTool,
} from "./nim";
import { ENV } from "./_core/env";
import type {
  WorkspaceAgentOptions,
  WorkspaceToolActivity,
} from "./workspaceAgentTypes";

/**
 * Nova's /init prompt - opencode's built-in `initialize.txt` with every
 * instance of opencode replaced by Nova, everything else intact.
 */
export const AGENTS_INIT_PROMPT_BASE = `Create or update \`AGENTS.md\` for this repository.\nThe goal is a compact instruction file that helps future Nova sessions avoid mistakes and ramp up quickly. Every line should answer: "Would an agent likely miss this without help?" If not, leave it out.\nUser-provided focus or constraints (honor these):\n$ARGUMENTS\n## How to investigate\nRead the highest-value sources first:\n- \`README*\`, root manifests, workspace config, lockfiles\n- build, test, lint, formatter, typecheck, and codegen config\n- CI workflows and pre-commit / task runner config\n- existing instruction files (\`AGENTS.md\`, \`CLAUDE.md\`, \`.cursor/rules/\`, \`.cursorrules\`, \`.github/copilot-instructions.md\`)\n- repo-local Nova config such as \`nova.json\`\nIf architecture is still unclear after reading config and docs, inspect a small number of representative code files to find the real entrypoints, package boundaries, and execution flow. Prefer reading the files that explain how the system is wired together over random leaf files.\nPrefer executable sources of truth over prose. If docs conflict with config or scripts, trust the executable source and only keep what you can verify.\n## What to extract\nLook for the highest-signal facts for an agent working in this repo:\n- exact developer commands, especially non-obvious ones\n- how to run a single test, a single package, or a focused verification step\n- required command order when it matters, such as \`lint -> typecheck -> test\`\n- monorepo or multi-package boundaries, ownership of major directories, and the real app/library entrypoints\n- framework or toolchain quirks: generated code, migrations, codegen, build artifacts, special env loading, dev servers, infra deploy flow\n- repo-specific style or workflow conventions that differ from defaults\n- testing quirks: fixtures, integration test prerequisites, snapshot workflows, required services, flaky or expensive suites\n- important constraints from existing instruction files worth preserving\nGood \`AGENTS.md\` content is usually hard-earned context that took reading multiple files to infer.\n## Questions\nOnly ask the user questions if the repo cannot answer something important. When something important is genuinely unknowable from the repository alone, make the most conservative reasonable assumption and record it in the file as an assumption rather than guessing.\nGood questions:\n- undocumented team conventions\n- branch / PR / release expectations\n- missing setup or test prerequisites that are known but not written down\nDo not ask about anything the repo already makes clear.\n## Writing rules\nInclude only high-signal, repo-specific guidance such as:\n- exact commands and shortcuts the agent would otherwise guess wrong\n- architecture notes that are not obvious from filenames\n- conventions that differ from language or framework defaults\n- setup requirements, environment quirks, and operational gotchas\n- references to existing instruction sources that matter\nExclude:\n- generic software advice\n- long tutorials or exhaustive file trees\n- obvious language conventions\n- speculative claims or anything you could not verify\n- content better stored in another file referenced via \`nova.json\` \`instructions\`\nWhen in doubt, omit.\nPrefer short sections and bullets. If the repo is simple, keep the file simple. If the repo is large, summarize the few structural facts that actually change how an agent should work.\nIf \`AGENTS.md\` already exists at \`${E2B_WORKSPACE_DIR}\`, improve it in place rather than rewriting blindly. Preserve verified useful guidance, delete fluff or stale claims, and reconcile it with the current codebase.`;

/**
 * The autonomous operating manual for the preparing_next_turn subagent. It
 * works directly in the workspace sandbox like the editor specialist: the
 * durable store is synced into the sandbox before it starts, and anything it
 * writes there is synced back into Neon afterwards by the run's finally block.
 */
const INIT_SYSTEM_PROMPT = `You are Nova's background subagent working autonomously inside the user's live workspace sandbox. The workspace files live in ${E2B_WORKSPACE_DIR} - they are the user's real files. Nobody is watching mid-task, so do not ask questions: decide and act.

Your task arrives as a full instruction sheet below. Follow its "How to investigate", "What to extract" and "Writing rules" sections exactly.

Tools:
- list_files: every file in the workspace (paths relative to ${E2B_WORKSPACE_DIR}).
- read_file: one file's full content.
- write_file: create or completely overwrite one file. Always send the FULL final content, never placeholders or partial diffs.
- run_command: one bash command executed in ${E2B_WORKSPACE_DIR} - read repo config, inspect the tree, build, test. Output is truncated, so keep commands focused.

How to work:
1. List the files, then read the highest-value sources the task names before writing anything. Explore in parallel when you can.
2. Write the deliverable with write_file (workspace-relative paths only). Your deliverable is the AGENTS.md file itself: apply every "Writing rules" include/exclude rule from the instruction sheet.
3. Verify your work: read the written file back and check it against the instruction sheet's rules before finishing.
4. Never delete or rename workspace files with shell commands (the durable store would resurrect them); to replace content, overwrite the file with write_file.
5. Stay inside the workspace: scratch files go in /tmp, installs go in the sandbox, and write_file only accepts workspace-relative paths.
6. When the file is written and verified, stop calling tools and reply with a short plain-text summary: which file you wrote, the headline facts it captures, and what you deliberately left out.

Rules:
- Complete file content only - never "..." placeholders or instructions to imagine the rest.
- Never assume. Inspect the relevant files, repository state, documentation, or other reliable source before making a choice, even when uncertainty is slight. If an important ambiguity remains after checking, take the most conservative reasonable assumption and record it as an assumption. Never invent APIs, paths, dependencies, data, or requirements.
- If the task is impossible as stated, write the closest workable version of the deliverable and say in one line what you changed.`;

/** The tools the subagent may call in the sandbox. */
const INIT_TOOLS: NimAgentTool[] = [
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
            description: "Workspace-relative file path, e.g. 'AGENTS.md'.",
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
      description: `Run one bash command in the workspace directory. Output is truncated to the first 4000 characters.`,
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

/** The single service-visible activity name for this whole subagent run. */
export const PREPARING_NEXT_TURN_ACTIVITY = "preparing_next_turn";

/** Compaction budget, reusing the editor specialist's proven constants. */
const CONTEXT_CHAR_BUDGET = 300_000;
const CONTEXT_KEEP_RECENT_MESSAGES = 8;
const CONTEXT_RECENT_TOOL_CAP = 12_000;
const CONTEXT_ASSISTANT_CAP = 4_000;
const CONTEXT_OLD_TOOL_STUB =
  "(earlier tool output omitted to stay within the model's context window)";
/** One round's output-token cap (file payloads count as output). */
const MAX_TOKENS = 16_384;
const READ_LIMIT = 16_000;
const COMMAND_OUTPUT_LIMIT = 4_000;
const COMMAND_TIMEOUT_MS = 120_000;

/** The final status the parent's activity settles to. */
export type AgentsInitOutcome = {
  ok: boolean;
  summary: string;
};

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

/** Approximate size of the subagent's conversation, in characters. */
function contextChars(messages: NimAgentMessage[]): number {
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
 * Shrinks the subagent's conversation toward the context budget without
 * breaking it. Messages up to and including the first user turn (the system
 * prompt and the task intro) are never touched: they are the anchor. Older
 * tool results become a stub, the most recent ones are capped, and long
 * interim assistant text is trimmed - assistant tool_calls are always kept
 * intact, so every tool result still follows the call it answers. Returns
 * true when anything changed.
 */
function compactContext(
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

/**
 * Lists the workspace files for the subagent's intro prompt and list_files.
 * Failures stay failures: a thrown command or non-zero exit must not read
 * as a successful empty listing.
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
      result: listing.length > 0 ? listing.join("\n") : "(the workspace is empty)",
    };
  } catch {
    return { ok: false, result: "(could not list the workspace)" };
  }
}

/** The short identifying args an activity carries (no payloads). */
function initToolArgs(
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

/** One-line summary of a settled subagent tool call. */
function initToolSummary(
  name: string,
  args: Record<string, string>,
  ok: boolean
): string {
  const brief = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;
  switch (name) {
    case "list_files":
      return ok ? "Listed the workspace files." : "Could not list the workspace files.";
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

/** Executes one subagent tool call, returning its ok flag and result text. */
async function executeInitToolCall(
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
            text.length > 0 ? truncate(text, READ_LIMIT) : "(the file is empty)",
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
        return { ok: false, result: "write_file needs the file's full content." };
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
      if (!command) return { ok: false, result: "run_command needs a command." };
      // Same boundary as the editor: the durable store only imports sandbox
      // files, so a shell delete or rename would diverge from it and the
      // file would resurrect on the next run.
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
            "use write_file with the full new content.",
        };
      }
      const timeoutMs = Math.min(COMMAND_TIMEOUT_MS, Math.max(0, remainingMs));
      try {
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
 * Runs the preparing_next_turn subagent: one autonomous pass over the
 * workspace with the full Nova /init instruction sheet, writing or improving
 * AGENTS.md and syncing back into the durable store. Bounded only by the
 * caller's deadline - when the budget ends before a final summary, what was
 * written so far is still real.
 */
export async function runAgentsInitTask(
  options: {
    sandbox: E2BSandboxLike;
    /** When the overall background window must be over. */
    deadlineAtMs: number;
  }
): Promise<{ summary: string; wroteAgentsMd: boolean }> {
  const budgetEndMs = options.deadlineAtMs;
  const intro = AGENTS_INIT_PROMPT_BASE.replace(
    "$ARGUMENTS",
    "(none this time - derive everything from the repository itself)"
  ) + `\n\nThe workspace currently holds these files (paths relative to ${E2B_WORKSPACE_DIR}):\n\n${
    (await listWorkspaceFiles(options.sandbox)).result
  }`;

  const messages: NimAgentMessage[] = [
    { role: "system", content: INIT_SYSTEM_PROMPT },
    { role: "user", content: intro },
  ];
  const writtenPaths = new Set<string>();
  let roundsRun = 0;
  let summary = "";

  while (true) {
    const remainingMs = budgetEndMs - Date.now();
    if (remainingMs <= 0) break;
    const round = roundsRun;
    roundsRun += 1;
    if (contextChars(messages) > CONTEXT_CHAR_BUDGET) compactContext(messages);
    let reply;
    try {
      reply = await runNimAgentChat({
        messages,
        tools: INIT_TOOLS,
        model: ENV.nimCoderModel,
        apiUrl: ENV.nimCoderApiUrl,
        apiKey: ENV.nimCoderApiKey,
        maxTokens: MAX_TOKENS,
        timeoutMs: Math.min(240_000, remainingMs),
        deadlineAtMs: budgetEndMs,
      });
    } catch (error) {
      if (error instanceof NimContextLengthError) {
        const freed = compactContext(messages, { aggressive: true });
        if (freed && budgetEndMs - Date.now() >= 30_000) continue;
        summary = freed
          ? "The subagent's conversation outgrew the model's context window; it compacted the earlier steps but the window closed before it could retry."
          : "The subagent's conversation grew past the model's context window and could no longer be compacted.";
      } else if (round === 0 && writtenPaths.size === 0) {
        summary = `The subagent could not start: ${
          error instanceof Error ? error.message : "unknown error"
        }`;
      } else {
        summary = `The subagent hit a failure mid-task (${
          error instanceof Error ? error.message : "unknown error"
        }) after writing ${writtenPaths.size} file(s).`;
      }
      break;
    }
    if (reply.kind === "text") {
      summary = reply.text;
      break;
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
      if (remainingForTool <= 0) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "The window ran out of time before this call could start, so it was not executed. Do not assume its result.",
        });
        continue;
      }
      let execution: { ok: boolean; result: string };
      try {
        execution = await executeInitToolCall(
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
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: execution.result,
      });
    }
  }

  if (!summary) {
    summary = roundsRun === 0
      ? "The subagent could not start inside the background window."
      : `The subagent used the window's full time budget before writing a final summary (${roundsRun} round(s)); wrote ${writtenPaths.size} file(s).`;
  }
  return {
    summary,
    wroteAgentsMd: writtenPaths.has("AGENTS.md"),
  };
}

/** The background window the preparing subagent gets when a run just ended. */
const PREPARE_WINDOW_MS = 240_000;
/**
 * The activity args shape chatMessages.tsx expects: every tool row carries
 * its call arguments (possibly empty) in args.arguments.
 */
const PREPARE_ARGS = { arguments: "{}" };

/**
 * Launches the preparing_next_turn subagent after a completed agent run that
 * changed the workspace. Awaiting callers keep their post-run sequencing
 * (sync, pause, response flush) ordered after the subagent has written.
 *
 * The user sees exactly one activity: `preparing_next_turn` running while the
 * subagent works, settling to completed or failed when it is done. The final
 * summary is serialized into the activity args (a JSON string inside
 * args.arguments) so the client's parseToolArgs can display it without any
 * new activity type: parseToolArgs falls back to the tool label before that.
 *
 * Never throws: the whole window is wrapped, and the activity is always
 * settled so a failed subagent cannot leave a permanently spinning row.
 *
 * The subagent runs INSIDE this window (not on waitUntil): the caller has
 * already awaited this launch before touching the sandbox sync/pause, so the
 * subagent finishes (and its writes are mirrored) before the sandbox is
 * synced back and paused; moving it to a detached waitUntil could race the
 * pause and sync, and Vercel's generous web maxDuration covers the window.
 */
export async function launchPreparingNextTurn(input: {
  ownerId: number;
  chatId: string;
  /** The run's live sandbox (already synced into and warm); absent when E2B is not configured or the wake failed. */
  sandbox: E2BSandboxLike | undefined;
  /** The workspace id the sandbox belongs to, for the sync-back step. */
  workspaceId: number | undefined;
  /** The run's activity emitter - the subagent's status rides the same channel. */
  onEvent?: WorkspaceAgentOptions["onEvent"];
}): Promise<void> {
  const emit = async (tool: WorkspaceToolActivity) => {
    try {
      await input.onEvent?.({ type: "tool", tool });
    } catch {}
  };
  const startedAt = Date.now();
  try {
    if (!input.sandbox || input.workspaceId === undefined) {
      // No live sandbox (E2B unconfigured or the wake failed): the subagent
      // cannot work, so settle the activity to failed with an honest note
      // instead of leaving it spinning forever.
      await emit({
        id: `${PREPARING_NEXT_TURN_ACTIVITY}-${startedAt}`,
        name: PREPARING_NEXT_TURN_ACTIVITY,
        state: "failed",
        args: {
          arguments: JSON.stringify({
            summary: "The workspace sandbox is not available, so AGENTS.md was not refreshed.",
          }),
        },
        summary: "Could not prepare the next turn: the workspace sandbox is not available.",
      });
      return;
    }
    await emit({
      id: `${PREPARING_NEXT_TURN_ACTIVITY}-${startedAt}`,
      name: PREPARING_NEXT_TURN_ACTIVITY,
      state: "running",
      args: PREPARE_ARGS,
      summary:
        "Preparing the next turn: Nova is reading the changed workspace and keeping AGENTS.md current.",
    });
    const workspaceId = input.workspaceId;
    const outcome = await runAgentsInitTask({
      sandbox: input.sandbox,
      deadlineAtMs: Date.now() + PREPARE_WINDOW_MS,
    });
    // Sync the subagent's writes into the durable Neon/S3 store immediately
    // under the workspace lock while the sandbox is still warm, then leave
    // the pause decision to the run's finally block (which runs after this
    // await, so it always lands after the subagent has finished).
    await syncAgentSandbox(input.ownerId, workspaceId, input.sandbox);
    await emit({
      id: `${PREPARING_NEXT_TURN_ACTIVITY}-${startedAt}`,
      name: PREPARING_NEXT_TURN_ACTIVITY,
      state: outcome.wroteAgentsMd ? "completed" : "failed",
      args: {
        arguments: JSON.stringify({ summary: outcome.summary }),
      },
      summary: outcome.wroteAgentsMd
        ? "Prepared the next turn: AGENTS.md is current."
        : `Preparing the next turn did not finish: ${outcome.summary}`,
    });
  } catch (error) {
    console.error("[PreparingNextTurn] subagent failed", error);
    await emit({
      id: `${PREPARING_NEXT_TURN_ACTIVITY}-${startedAt}`,
      name: PREPARING_NEXT_TURN_ACTIVITY,
      state: "failed",
      args: {
        arguments: JSON.stringify({
          summary:
            error instanceof Error ? error.message : "The subagent failed unexpectedly.",
        }),
      },
      summary: "Preparing the next turn failed.",
    });
  }
}
