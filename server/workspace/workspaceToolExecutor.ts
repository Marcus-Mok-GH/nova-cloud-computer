/**
 * The workspace agent's tool executor: parses the model's tool call, builds
 * the per-call context (arguments, paths, sandbox, run budget) and routes to
 * the tool's implementation. Every family lives in its own module under
 * `workspaceTools/` - files, folders, plans, deploys, telegram, connectors,
 * personalisation, memories, equation, codec, research, thinker, editor, vm
 * and browser - so the run loop, each tool family, and this thin router can
 * be read and changed independently. Only the skill, wallet/email approval
 * and workspace-summary tools stay inline; they are small wirings to the db
 * and approval queues with no shared machinery. The run-context fields on
 * ToolCtx (sandbox, deadline, progress callbacks) let the sub-agent tools
 * live in their family modules like everything else.
 */
import {
  requestAgentEmailApproval,
  requestWalletPurchaseApproval,
} from "../agents";
import {
  type GatewayToolCall,
} from "../aiGateway";
import { getSkillByNameForUser } from "../skills";
import { type SandboxOp, mirrorWorkspaceOp } from "../sandboxWorkspace";
import { type E2BSandboxLike } from "../e2b";

import {
  type AgentChatRunOptions,
  type WorkspaceToolActivity,
} from "./workspaceAgentTypes";
import { describeWorkspace } from "../workspaceTools/resolve";
import { toolCreateFile, toolReadFile, toolEditFile, toolRenameFile, toolMoveFile, toolDeleteFile } from "../workspaceTools/files";
import { toolCreateFolder, toolRenameFolder, toolMoveFolder, toolDeleteFolder } from "../workspaceTools/folders";
import { toolCreatePlan, toolEditPlan } from "../workspaceTools/plans";
import { toolDeployWebsite, toolDeleteWebsite, toolCreateProjectTemplate } from "../workspaceTools/deploy";
import { toolSendTelegramMessage, toolSendProgressUpdate, toolPresentFile } from "../workspaceTools/telegram";
import { toolSetCommunicationStyle, toolSetPersonalisation } from "../workspaceTools/personalisation";
import { toolGithub, toolListConnectorTools, toolUseConnectorTool } from "../workspaceTools/connectors";
import { toolSearchMemories, toolReadMemory, toolSaveMemory, toolDeleteMemory } from "../workspaceTools/memories";
import { toolSetEnvVar } from "../workspaceTools/envvars";
import { toolSolveEquation } from "../workspaceTools/equation";
import { toolBase44 } from "../workspaceTools/codec";
import { toolResearchWeb } from "../workspaceTools/research";
import { toolThinker } from "../workspaceTools/thinker";
import { toolAcceptOwnCoding, toolEditor } from "../workspaceTools/editor";
import { toolRunBash, toolRunVmTask } from "../workspaceTools/vm";
import { toolBrowse } from "../workspaceTools/browser";
import {
  type Computer,
  type ToolCtx,
  type ToolExecution,
  type OwnCodingGate,
} from "../workspaceTools/types";

export type { OwnCodingGate, ToolExecution };

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
    callId: call.id,
    agentChat,
    memoryScope,
    onProgress,
    sandbox,
    deadlineAtMs,
    onSubToolActivity,
  };
  switch (call.name) {
    case "search_memories":
      return toolSearchMemories(ctx);
    case "read_memory":
      return toolReadMemory(ctx);
    case "save_memory":
      return toolSaveMemory(ctx);
    case "set_env_var":
      return toolSetEnvVar(ctx);
    case "delete_memory":
      return toolDeleteMemory(ctx);
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
    case "solve_equation":
      return toolSolveEquation(ctx);
    case "base44":
      return toolBase44(ctx);
    case "research_web":
      return toolResearchWeb(ctx);
    case "thinker":
      return toolThinker(ctx);
    case "accept_own_coding":
      return toolAcceptOwnCoding(ctx);
    case "editor":
      return toolEditor(ctx);
    case "run_bash":
      return toolRunBash(ctx);
    case "browse":
      return toolBrowse(ctx);
    case "run_vm_task":
      return toolRunVmTask(ctx);
    default:
      return { ok: false, result: `Unknown tool: ${call.name}.` };
  }
}
