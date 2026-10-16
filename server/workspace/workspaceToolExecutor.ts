/**
 * The workspace agent's tool executor: routes every tool call the model
 * requests to its implementation. Persisted file/folder/plan/deploy/telegram
 * tools live in per-family modules under `workspaceTools/`; this file keeps
 * the sub-agent specialists (editor, researcher, thinker), memory and skill
 * tools, and the sandbox/VM/desktop-browse tools that need the live run
 * context (progress callbacks, sandbox, deadlines). Split from the original
 * single-file executor so the run loop and each tool family can be read and
 * changed independently.
 */
import { startAgentVmRun } from "../agentVm";
import { runDesktopBrowseCommand } from "../desktopBrowser";
import {
  requestAgentEmailApproval,
  requestWalletPurchaseApproval,
} from "../agents";
import {
  type GatewayToolCall,
} from "../aiGateway";
import {
  decodeBase44Text,
  encodeBase44Text,
} from "../base44";
import {
  MIN_CALL_RESERVE_MS,
  runAutonomousCoderTask,
  runCoderTask,
  type CoderOutcome,
  type CoderToolActivity,
} from "../coder";
import {
  updateWorkspaceBrowserSandbox,
} from "../db";
import {
  getE2BClient,
  type E2BSandboxLike,
} from "../e2b";
import {
  deleteMemoryForUser,
  readMemoryForUser,
  saveMemoryForUser,
  searchMemoriesForUser,
} from "../memories";
import { getSkillByNameForUser } from "../skills";
import { NimConfigError } from "../nim";
import { runResearch } from "../researcher";
import {
  mirrorWorkspaceOp,
  runBashOnSandbox,
  syncAgentSandbox,
  type SandboxOp,
} from "../sandboxWorkspace";
import { trackRunningProcess } from "../runningProcesses";
import { runThinkerTask } from "../thinker";
import { evaluate } from "mathjs";

import {
  type AgentChatRunOptions,
  type WorkspaceToolActivity,
  recordSpecialistAcceptance,
} from "./workspaceAgentTypes";
import { describeWorkspace } from "../workspaceTools/resolve";
import { saveBrowseCapture } from "../workspaceTools/capture";
import { toolCreateFile, toolReadFile, toolEditFile, toolRenameFile, toolMoveFile, toolDeleteFile } from "../workspaceTools/files";
import { toolCreateFolder, toolRenameFolder, toolMoveFolder, toolDeleteFolder } from "../workspaceTools/folders";
import { toolCreatePlan, toolEditPlan } from "../workspaceTools/plans";
import { toolDeployWebsite, toolDeleteWebsite, toolCreateProjectTemplate } from "../workspaceTools/deploy";
import { toolSendTelegramMessage, toolSendProgressUpdate, toolPresentFile } from "../workspaceTools/telegram";
import { toolSetCommunicationStyle, toolSetPersonalisation } from "../workspaceTools/personalisation";
import { toolGithub, toolListConnectorTools, toolUseConnectorTool } from "../workspaceTools/connectors";
import {
  type Computer,
  type ToolCtx,
  type ToolExecution,
  type OwnCodingGate,
} from "../workspaceTools/types";

export type { OwnCodingGate, ToolExecution };

/** Formats a numeric mathjs result for the agent: clean integers, readable decimals. */
function formatMathAnswer(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Round long floats to 6 decimal places, trimming trailing zeros.
  return String(Math.round(value * 1e6) / 1e6);
}

/** Executes a single model-requested tool call against the workspace. */
export async function executeWorkspaceTool(
  ownerId: number,
  computer: Computer,
  call: GatewayToolCall,
  onProgress?: (detail: string) => void,
  sandbox?: E2BSandboxLike,
  gate?: OwnCodingGate,
  channel?: "telegram" | "web",
  deadlineAtMs?: number,
  chatId?: string,
  /**
   * Receives the editor specialist's own tool calls (read/write/list/command)
   * as they happen, so they stream as first-class activity rows like the
   * agent's own tool calls instead of prose notes.
   */
  onSubToolActivity?: (tool: WorkspaceToolActivity) => void | Promise<void>,
  /** Personal-agent context: scopes memory and enables the gated identity tools. */
  agentChat?: AgentChatRunOptions
): Promise<ToolExecution> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    if (args === null || typeof args !== "object") args = {};
  } catch {
    return { ok: false, result: "Invalid JSON arguments." };
  }
  const str = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  // An agent's memory tools read and write its own scope (plus shared notes);
  // the default assistant stays in the shared workspace scope.
  const memoryScope = agentChat
    ? { agentId: agentChat.profile.id }
    : undefined;
  // Sandbox-first execution: the workspace sandbox (woken at run start) is
  // the live execution surface, and the durable Neon/S3 store syncs from it.
  // Every mutating file/folder operation is mirrored onto the sandbox
  // filesystem; a mirror failure is logged but never blocks the durable op.
  const folderRows = computer.folders as Array<{
    id: number;
    name: string;
    parentId: number | null;
  }>;
  const mirror = async (op: SandboxOp) => {
    if (!sandbox) return;
    try {
      const mirrored = await mirrorWorkspaceOp(sandbox, op);
      if (!mirrored.ok)
        console.error("[Sandbox mirror] failed", op.kind, mirrored.error);
    } catch (error) {
      console.error("[Sandbox mirror] error", op.kind, error);
    }
  };
  const ctx: ToolCtx = {
    ownerId,
    computer,
    args,
    str,
    folderRows,
    mirror,
    gate,
    chatId,
    channel,
  };
  switch (call.name) {
    case "search_memories": {
      const query = str(args.query).trim();
      const limitArg = Number(args.limit);
      const limit = Number.isFinite(limitArg) && limitArg >= 1 ? limitArg : 8;
      const records = memoryScope
        ? await searchMemoriesForUser(ownerId, query, limit, memoryScope)
        : await searchMemoriesForUser(ownerId, query, limit);
      return {
        ok: true,
        result: records.length
          ? records
              .map(
                record =>
                  `Memory ${record.id} - ${record.title} (updated ${record.updatedAt.toISOString().slice(0, 10)}): ${record.summary}`
              )
              .join("\n")
          : "No memories matched that search.",
        action: {
          kind: "tool",
          name: query.slice(0, 60) || "recent memories",
          operation: records.length ? "listed" : "failed",
        },
      };
    }
    case "read_memory": {
      const id = Number(args.id);
      const record =
        Number.isFinite(id) && id > 0
          ? await readMemoryForUser(ownerId, id, memoryScope)
          : null;
      if (!record)
        return {
          ok: false,
          result: `No memory with id ${str(args.id)} - search_memories lists the valid ids.`,
          action: {
            kind: "tool",
            name: `memory ${str(args.id)}`,
            operation: "failed",
          },
        };
      return {
        ok: true,
        result: `Memory ${record.id} - ${record.title}\n\n${record.content}`,
        action: {
          kind: "tool",
          name: `memory ${record.id}`,
          operation: "listed",
        },
      };
    }
    case "save_memory": {
      const title = str(args.title).trim();
      const summary = str(args.summary).trim();
      const content = str(args.content);
      if (!title || !summary || !content.trim())
        return {
          ok: false,
          result: "A memory needs a title, a summary, and content.",
          action: { kind: "tool", name: "save_memory", operation: "failed" },
        };
      const record = await saveMemoryForUser(ownerId, {
        title,
        summary,
        content,
        tags: args.tags !== undefined ? str(args.tags) : null,
        agentId: agentChat?.profile.id ?? null,
      });
      if (!record)
        return {
          ok: false,
          result: "The memory store is unavailable right now.",
          action: {
            kind: "tool",
            name: title.slice(0, 60),
            operation: "failed",
          },
        };
      return {
        ok: true,
        result: `Saved memory ${record.id}: ${record.title}.`,
        action: {
          kind: "tool",
          name: title.slice(0, 60),
          operation: "created",
        },
      };
    }
    case "delete_memory": {
      const id = Number(args.id);
      const deleted =
        Number.isFinite(id) && id > 0
          ? await deleteMemoryForUser(ownerId, id, memoryScope)
          : false;
      if (!deleted)
        return {
          ok: false,
          result: `No memory with id ${str(args.id)} - search_memories lists the valid ids.`,
          action: {
            kind: "tool",
            name: `memory ${str(args.id)}`,
            operation: "failed",
          },
        };
      return {
        ok: true,
        result: `Deleted memory ${id}.`,
        action: { kind: "tool", name: `memory ${id}`, operation: "deleted" },
      };
    }
    case "read_skill": {
      const name = str(args.name);
      const skill = name ? await getSkillByNameForUser(ownerId, name) : null;
      if (!skill)
        return {
          ok: false,
          result: `No skill named "${name || "(empty)"}" - the skills block in the system prompt lists the installed names.`,
          action: {
            kind: "tool",
            name: name.slice(0, 60) || "read_skill",
            operation: "failed",
          },
        };
      return {
        ok: true,
        result: `Skill ${skill.name} - ${skill.description}\n\n${
          skill.body.trim() ||
          "(This skill has no instructions yet - ask the user to fill them in on Nova's Skills page.)"
        }`,
        action: {
          kind: "tool",
          name: skill.name.slice(0, 60),
          operation: "listed",
        },
      };
    }
    case "request_purchase": {
      if (!agentChat)
        return {
          ok: false,
          result:
            "request_purchase is only available to personal agents with a wallet.",
          action: { kind: "tool", name: "purchase request", operation: "failed" },
        };
      const outcome = await requestWalletPurchaseApproval(ownerId, {
        agentId: agentChat.profile.id,
        chatId: chatId ?? null,
        item: str(args.item),
        amountCredits: Number(args.amount_credits),
        note: str(args.note) || null,
      });
      if (!outcome.ok)
        return {
          ok: false,
          result: outcome.error,
          action: {
            kind: "tool",
            name: `purchase ${str(args.item).slice(0, 50) || "request"}`,
            operation: "failed",
          },
        };
      return { ok: true, result: outcome.message };
    }
    case "send_agent_email": {
      if (!agentChat)
        return {
          ok: false,
          result:
            "send_agent_email is only available to personal agents with an identity.",
          action: { kind: "tool", name: "agent email", operation: "failed" },
        };
      const outcome = await requestAgentEmailApproval(ownerId, {
        agentId: agentChat.profile.id,
        chatId: chatId ?? null,
        to: str(args.to),
        subject: str(args.subject),
        body: str(args.body),
      });
      if (!outcome.ok)
        return {
          ok: false,
          result: outcome.error,
          action: { kind: "tool", name: "agent email", operation: "failed" },
        };
      return { ok: true, result: outcome.message };
    }
    case "list_workspace": {
      const { folders, files } = describeWorkspace(computer);
      return {
        ok: true,
        result: `Folders: ${folders}. Files: ${files}.`,
      };
    }
    case "create_file":
      return toolCreateFile(ctx);
    case "read_file":
      return toolReadFile(ctx);
    case "edit_file":
      return toolEditFile(ctx);
    case "rename_file":
      return toolRenameFile(ctx);
    case "move_file":
      return toolMoveFile(ctx);
    case "delete_file":
      return toolDeleteFile(ctx);
    case "create_folder":
      return toolCreateFolder(ctx);
    case "rename_folder":
      return toolRenameFolder(ctx);
    case "move_folder":
      return toolMoveFolder(ctx);
    case "delete_folder":
      return toolDeleteFolder(ctx);
    case "create_plan":
      return toolCreatePlan(ctx);
    case "edit_plan":
      return toolEditPlan(ctx);
    case "deploy_website":
      return toolDeployWebsite(ctx);
    case "delete_website":
      return toolDeleteWebsite(ctx);
    case "create_project_template":
      return toolCreateProjectTemplate(ctx);
    case "send_telegram_message":
      return toolSendTelegramMessage(ctx);
    case "send_progress_update":
      return toolSendProgressUpdate(ctx);
    case "present_file":
      return toolPresentFile(ctx);
    case "set_communication_style":
      return toolSetCommunicationStyle(ctx);
    case "set_personalisation":
      return toolSetPersonalisation(ctx);
    case "github":
      return toolGithub(ctx);
    case "list_connector_tools":
      return toolListConnectorTools(ctx);
    case "use_connector_tool":
      return toolUseConnectorTool(ctx);
    case "solve_equation": {
      const equation = str(args.equation).trim();
      if (!equation)
        return { ok: false, result: "An equation to solve is required." };
      try {
        const answer = evaluate(equation);
        if (
          answer === undefined ||
          answer === null ||
          (typeof answer === "number" && !Number.isFinite(answer))
        ) {
          const noNumber = `That expression does not evaluate to a number (got: ${String(answer)}). Pass a single numeric expression like '20 - 11.33'.`;
          return {
            ok: false,
            result: noNumber,
            detail: noNumber,
            action: {
              kind: "tool",
              name: equation.slice(0, 60),
              operation: "failed",
            },
          };
        }
        const formatted =
          typeof answer === "number"
            ? formatMathAnswer(answer)
            : String(answer);
        return {
          ok: true,
          result: `${equation} = ${formatted}`,
          detail: `${equation} = ${formatted}`,
          action: {
            kind: "tool",
            name: equation.slice(0, 60),
            operation: "completed",
          },
        };
      } catch (error) {
        const failure = `Could not evaluate '${equation}': ${error instanceof Error ? error.message : "invalid expression"}. Pass a single numeric expression like '20 - 11.33' or 'sqrt(196) * 3.5'.`;
        return {
          ok: false,
          result: failure,
          detail: failure,
          action: {
            kind: "tool",
            name: equation.slice(0, 60),
            operation: "failed",
          },
        };
      }
    }
    case "base44": {
      const operation = str(args.operation);
      if (operation !== "encode" && operation !== "decode")
        return {
          ok: false,
          result: "Base44 operation must be either encode or decode.",
          action: { kind: "tool", name: "base44", operation: "failed" },
        };
      if (typeof args.value !== "string")
        return {
          ok: false,
          result: "A value is required for Base44 encoding or decoding.",
          action: {
            kind: "tool",
            name: `base44 ${operation}`,
            operation: "failed",
          },
        };
      try {
        const value = args.value;
        const result =
          operation === "encode"
            ? encodeBase44Text(value)
            : decodeBase44Text(value);
        return {
          ok: true,
          result,
          detail: result,
          action: {
            kind: "tool",
            name: `base44 ${operation}`,
            operation: "completed",
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "invalid Base44 value";
        return {
          ok: false,
          result: `Base44 ${operation} failed: ${message}.`,
          action: {
            kind: "tool",
            name: `base44 ${operation}`,
            operation: "failed",
          },
        };
      }
    }
    case "research_web": {
      const topic = str(args.topic);
      if (!topic) return { ok: false, result: "A research topic is required." };
      const difficulty = str(args.difficulty) || undefined;
      const instructions = str(args.instructions) || undefined;
      const level =
        difficulty === "deep-lite" || difficulty === "deep-reasoning"
          ? difficulty
          : "deep";
      const startedAt = Date.now();
      // The researcher streams its real process now (sub-search results, the
      // start of report synthesis). The elapsed-time heartbeat only fires
      // when the stream has gone quiet, so the log shows work, not ticking.
      let lastNoteAt = Date.now();
      const note = (detail: string) => {
        lastNoteAt = Date.now();
        onProgress?.(detail);
      };
      const progressTimer = onProgress
        ? setInterval(() => {
            if (Date.now() - lastNoteAt < 25_000) return;
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            lastNoteAt = Date.now();
            onProgress(`Deep research is still working - ${elapsed}s elapsed…`);
          }, 10000)
        : undefined;
      note(`Deep research is starting its web searches…`);
      try {
        const research = await runResearch(
          topic,
          difficulty,
          instructions,
          note
        );
        const sourcesBlock = research.sources.length
          ? `\n\nAll sources consulted by the researcher:\n${research.sources
              .map(
                (source, index) =>
                  `${index + 1}. ${source.title || source.url} - ${source.url}`
              )
              .join("\n")}`
          : "";
        return {
          ok: true,
          result: research.report + sourcesBlock,
          detail: research.report + sourcesBlock,
          citations: research.sources,
          action: {
            kind: "research",
            name: topic.slice(0, 60),
            operation: "completed",
          },
        };
      } catch (error) {
        const message = `Web research failed: ${error instanceof Error ? error.message : "unknown error"}.`;
        return {
          ok: false,
          result: message,
          detail: message,
          action: {
            kind: "research",
            name: topic.slice(0, 60),
            operation: "failed",
          },
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }
    case "thinker": {
      const question = str(args.question).trim();
      if (!question)
        return { ok: false, result: "A question to think through is required." };
      const context = str(args.context) || undefined;
      const startedAt = Date.now();
      // The thinker works in one long model call; a quiet-stream heartbeat
      // keeps the activity panel honest while it reasons. The elapsed-time
      // note only fires when nothing newer has arrived.
      let lastNoteAt = Date.now();
      const note = (detail: string) => {
        lastNoteAt = Date.now();
        onProgress?.(detail);
      };
      const progressTimer = onProgress
        ? setInterval(() => {
            if (Date.now() - lastNoteAt < 25_000) return;
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            lastNoteAt = Date.now();
            onProgress(
              `The thinker sub-agent is still reasoning - ${elapsed}s elapsed…`
            );
          }, 10000)
        : undefined;
      note("The thinker sub-agent is reasoning through the question…");
      try {
        const thought = await runThinkerTask(question, context);
        return {
          ok: true,
          result: thought.analysis,
          detail: thought.analysis.slice(0, 16000),
          action: {
            kind: "tool",
            name: `thinker: ${question.slice(0, 45)}`,
            operation: "completed",
          },
        };
      } catch (error) {
        // Config problems (missing key, missing model ID for a custom
        // endpoint) already carry a clean, user-facing explanation.
        const message =
          error instanceof NimConfigError
            ? error.message
            : `The thinker sub-agent failed: ${
                error instanceof Error ? error.message : "unknown error"
              }.`;
        return {
          ok: false,
          result: message,
          detail: message,
          action: {
            kind: "tool",
            name: `thinker: ${question.slice(0, 45)}`,
            operation: "failed",
          },
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }
    case "accept_own_coding": {
      if (!gate) {
        return {
          ok: false,
          result:
            "There is no pending coding-specialist acceptance question - continue normally.",
        };
      }
      if (gate.specialistDownThisRun) {
        return {
          ok: false,
          result:
            "The coding specialist failed in this same run, so the user has not had a turn to answer yet. " +
            "Tell the user the specialist is down, ask whether to proceed with Nova's own attempt, and end your turn. " +
            "Only call accept_own_coding in a later conversation turn, after the user explicitly accepted.",
          action: {
            kind: "tool",
            name: "accept_own_coding",
            operation: "failed",
          },
        };
      }
      if (!gate.awaitingAcceptance) {
        return {
          ok: false,
          result:
            "There is no pending coding-specialist acceptance question. Only call this tool when the user has just " +
            "explicitly accepted Nova writing the code itself while the specialist is down.",
          action: {
            kind: "tool",
            name: "accept_own_coding",
            operation: "failed",
          },
        };
      }
      gate.awaitingAcceptance = false;
      gate.blocked = false;
      await recordSpecialistAcceptance(ownerId, gate.chatId, "accepted");
      return {
        ok: true,
        result:
          "Recorded: the user accepted Nova writing this code itself without the coding specialist. " +
          "You may proceed with create_file/edit_file for this task, and say plainly that the result is Nova's own work.",
        action: {
          kind: "tool",
          name: "accept_own_coding",
          operation: "completed",
        },
      };
    }
    case "editor": {
      const task = str(args.task).trim();
      if (!task) return { ok: false, result: "A coding task is required." };
      const context = str(args.context) || undefined;
      const language = str(args.language) || undefined;
      const startedAt = Date.now();
      // Durable ledger: the specialist task registers a running-process row BEFORE it starts, so when the platform
      // kills this invocation mid-task the reaper reconnects the editor to the same sandbox and finishes the coding
      // work in a fresh invocation - the sub-agent keeps running on its own instead of the main agent having to recall
      // it. Only the autonomous (sandbox) shape is resumable; the single-shot call is one bounded request whose result
      // dies with this invocation by design.
      const process = sandbox && chatId
        ? await trackRunningProcess({ workspaceId: computer.workspace.id, chatId, kind: "editor", payload: { task, context, language } }).catch(() => undefined)
        : undefined;
      let processStatus: "completed" | "failed" = "completed";
      // One coding task, two possible shapes: with a live sandbox the
      // specialist works autonomously (it lists, reads and writes workspace
      // files and runs commands itself, and its writes sync back into the
      // durable store); without one - or when the model lacks function
      // calling - it returns complete code for this agent to place. The
      // specialist streams its own steps; the elapsed-time heartbeat only
      // fires when its stream has gone quiet.
      let lastNoteAt = Date.now();
      const note = (detail: string) => {
        lastNoteAt = Date.now();
        onProgress?.(detail);
      };
      const progressTimer = onProgress
        ? setInterval(() => {
            if (Date.now() - lastNoteAt < 25_000) return;
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            lastNoteAt = Date.now();
            onProgress(
              `The coding specialist is still working - ${elapsed}s elapsed…`
            );
          }, 10000)
        : undefined;
      note(
        sandbox
          ? "The coding specialist is taking over the task - reading the workspace on its own…"
          : "The coding specialist is reading the task…"
      );
      const specialistError = (error: unknown) => {
        // Config problems already carry a clean, user-facing explanation.
        // Anything else is logged for diagnosis and replaced with a fixed
        // message: raw specialist errors can name internal services or
        // endpoints, and this text is fed back into the chat.
        if (error instanceof NimConfigError) return `${error.message}.`;
        console.error("[Editor] specialist failed:", error);
        return "The coding specialist failed unexpectedly. Please try again shortly.";
      };
      const runSpecialist = (): Promise<CoderOutcome> =>
        sandbox
          ? runAutonomousCoderTask({
              task,
              context,
              language,
              sandbox,
              onProgress: note,
              deadlineAtMs,
              // The specialist's own tool calls stream out as real activity
              // rows, namespaced under this editor call's id so they can
              // never collide across editor invocations in one run. Args are
              // repacked into the same { arguments: json } shape every tool
              // row uses, so the client renders them with its usual labels.
              ...(onSubToolActivity
                ? {
                    onToolActivity: (activity: CoderToolActivity) => {
                      return onSubToolActivity({
                        id: `${call.id}:${activity.id}`,
                        name: activity.name,
                        state: activity.state,
                        args: { arguments: JSON.stringify(activity.args) },
                        ...(activity.summary
                          ? { summary: activity.summary }
                          : {}),
                      });
                    },
                  }
                : {}),
            })
          : runCoderTask(task, context, language, deadlineAtMs).then(
              result => ({ kind: "single", ...result })
            );
      try {
        let outcome: CoderOutcome;
        try {
          outcome = await runSpecialist();
        } catch (error) {
          // A config error is deterministic - no retry helps, and the user
          // must hear exactly which key the operator has to set. Any
          // NimConfigError (missing key, missing model ID for a custom
          // endpoint, refused plaintext transport) is classified by type,
          // not by message text.
          if (error instanceof NimConfigError) throw error;
          const message = error instanceof Error ? error.message : "";
          if (message.includes("not configured")) throw error;
          // Transient specialist failures (timeouts, NIM hiccups) get one
          // automatic retry, so a single blip never pushes the agent into
          // silently hand-writing the code itself. The retry only runs when
          // the remaining budget still covers the wait plus the reserve the
          // specialist needs to start; otherwise it would begin work after
          // the run deadline and be discarded anyway.
          const retryWaitMs = 1500;
          if (
            deadlineAtMs !== undefined &&
            deadlineAtMs - Date.now() - retryWaitMs < 2 * MIN_CALL_RESERVE_MS
          )
            throw error;
          note("The coding specialist hit a snag - retrying once…");
          await new Promise(resolve => setTimeout(resolve, retryWaitMs));
          outcome = await runSpecialist();
        }
        if (outcome.kind === "single") {
          return {
            ok: true,
            result: outcome.code,
            detail: outcome.code.slice(0, 16000),
            action: {
              kind: "tool",
              name: `editor: ${task.slice(0, 45)}`,
              operation: "completed",
            },
          };
        }
        // Autonomous: the specialist's writes are already in the sandbox -
        // sync them into the durable store now so this run's later rounds
        // (and the workspace UI) see the real files. syncAgentSandbox never
        // throws, but a sync that silently failed is not a success story:
        // the claim below is anchored on the files the specialist wrote
        // (authoritative from the loop), and the end-of-run sync is the
        // backstop - so the instruction to read the files back and verify
        // also catches a file the sync missed.
        await syncAgentSandbox(ownerId, computer.workspace.id, sandbox);
        const fileList =
          outcome.writtenPaths.length > 0
            ? outcome.writtenPaths.join(", ")
            : "(none)";
        return {
          ok: true,
          result:
            `The coding specialist worked autonomously in the sandbox. Its summary: ${outcome.summary}\n\n` +
            `Files it wrote: ${fileList}. Read the changed files back from the workspace, verify the work actually meets the task, fix anything it left broken, and present the result to the user. If a changed file is missing from the workspace, say so plainly instead of improvising it.`,
          detail: `${outcome.summary}\n\nFiles written: ${fileList}`.slice(
            0,
            16000
          ),
          action: {
            kind: "tool",
            name: `editor: ${task.slice(0, 45)}`,
            operation: "completed",
          },
        };
      } catch (error) {
        // The task failed inside this invocation: the durable row closes with it - only a KILLED invocation leaves
        // its row behind for the reaper.
        processStatus = "failed";
        const message = specialistError(error);
        return {
          ok: false,
          result:
            `${message} The specialist is unavailable for this task, so do NOT silently write the code yourself: ` +
            `tell the user exactly that the coding specialist is down, and ask whether to proceed with Nova's own attempt. ` +
            `Non-trivial create_file and edit_file are blocked in this run; only in a LATER conversation turn, once the user has explicitly ` +
            `accepted Nova's own coding, call the accept_own_coding tool to record it, then write the code yourself and say plainly that ` +
            `it is Nova's own work without the specialist, so a broken result never comes as a surprise. ` +
            `Genuinely tiny fixes (a one-line change, a few lines of markup) remain allowed. ` +
            `If the user wants to wait instead, tell them the workspace owner needs to finish setting up the editor.`,
          detail: message,
          specialistDown: true,
          action: {
            kind: "tool",
            name: `editor: ${task.slice(0, 45)}`,
            operation: "failed",
          },
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
        // Close the durable row for this task; a killed invocation never reaches this line, which is exactly how its
        // row becomes resumable.
        await process?.finish(processStatus);
      }
    }
    case "run_bash": {
      const command = str(args.command);
      if (!command) return { ok: false, result: "A bash command is required." };
      if (!sandbox)
        return {
          ok: false,
          result:
            "The workspace sandbox is not available right now - it either failed to wake or it is not set up on this workspace yet. Use run_vm_task for shell work instead, and tell the user the sandbox needs to be set up first.",
          action: { kind: "vm", name: "bash", operation: "disabled" },
        };
      const bash = await runBashOnSandbox(sandbox, command);
      return {
        ok: bash.ok,
        result: bash.result,
        detail: bash.result.slice(0, 16000),
        action: {
          kind: "vm",
          name: "bash",
          operation: bash.ok ? "completed" : "failed",
        },
      };
    }
    case "browse": {
      const command = str(args.command);
      if (!command)
        return {
          ok: false,
          result:
            "A desktop command is required, e.g. 'open https://example.com', 'screenshot', or 'click 420 260'.",
        };
      // The desktop GUI runs in its own sandbox, not the workspace VM, so this
      // works even on a run whose VM failed to wake.
      const browserClient = getE2BClient();
      if (!browserClient)
        return {
          ok: false,
          result:
            "The desktop browser is not set up on this workspace (E2B is not configured), so nothing was opened. Tell the user the browser needs the workspace's E2B sandbox configured first.",
          action: { kind: "browser", name: "browser", operation: "disabled" },
        };
      const browse = await runDesktopBrowseCommand({
        client: browserClient,
        ownerId,
        workspaceId: computer.workspace.id,
        command,
        sandboxId: computer.workspace.browserSandboxId,
        onSandboxCreated: sandboxId =>
          updateWorkspaceBrowserSandbox(computer.workspace.id, sandboxId),
      });
      const saved = browse.screenshot
        ? await saveBrowseCapture(ownerId, browse.screenshot)
        : "";
      const result = [browse.result, saved].filter(Boolean).join("\n\n");
      return {
        ok: browse.ok,
        result,
        detail: result.slice(0, 16000),
        ...(browse.screenshot?.attachable
          ? { screenshot: browse.screenshot }
          : {}),
        action: {
          kind: "browser",
          name: command.trim().split(/\s+/)[0].slice(0, 45) || "browser",
          operation: browse.ok ? "completed" : "failed",
        },
      };
    }
    case "run_vm_task": {
      const task = str(args.task);
      if (!task) return { ok: false, result: "A task is required." };
      const started = await startAgentVmRun(
        ownerId,
        {
          task,
          code: str(args.code) || undefined,
          chatId,
        },
        // The sandbox already woke with this run and its files are current,
        // so a mid-run restore (which wipes and re-uploads the workspace,
        // losing bash-created files) must not run again.
        { skipRestore: Boolean(sandbox) }
      );
      if (!started.configured)
        return {
          ok: false,
          result: started.message,
          action: { kind: "vm", name: "E2B", operation: "disabled" },
        };
      return {
        ok: true,
        result: started.message,
        action: {
          kind: "vm",
          name: `run #${started.run?.id ?? ""}`,
          operation: "completed",
        },
      };
    }
    default:
      return { ok: false, result: `Unknown tool: ${call.name}.` };
  }
}
