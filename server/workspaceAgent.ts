import { ENV } from "./_core/env";
import {
  appendChatMessageForUser,
  getChatForUser,
  listChatMessagesForUser,
  renameChatIfDefaultForUser,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  deleteWorkspaceFileForUser,
  deleteWorkspaceFolderForUser,
  getWorkspaceComputer,
  getTelegramCredentialsForUser,
  updateWorkspaceFileForUser,
  updateWorkspaceFolderForUser,
  updateWorkspacePersistentSandbox,
} from "./db";
import { sendTelegramMessage } from "./telegram";
import { startAgentVmRun } from "./agentVm";
import {
  ensurePersistentSandbox,
  getE2BClient,
  runOpencodeChatInPersistentSandbox,
} from "./e2b";
import {
  persistE2BWorkspace,
  persistWorkspaceToObjectStorage,
  restoreWorkspaceToE2B,
} from "./workspaceSync";

export type AgentAction = {
  kind: "folder" | "file" | "telegram" | "vm";
  name: string;
  operation?:
    | "created"
    | "renamed"
    | "moved"
    | "deleted"
    | "sent"
    | "completed"
    | "disabled";
};

export type WorkspaceToolActivity = {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  args: Record<string, string>;
  summary?: string;
};

type WorkspaceAgentOptions = {
  onEvent?: (event: {
    type: "tool";
    tool: WorkspaceToolActivity;
  }) => void | Promise<void>;
  onChunk?: (chunk: string) => void | Promise<void>;
};

export const TOOL_ACTIVITY_MESSAGE_PREFIX = "__nova_tool_activity__:";

function actionSummary(action?: AgentAction) {
  if (!action) return "Nova could not complete this tool call.";
  if (action.operation === "disabled")
    return `${action.name} is not configured.`;
  const operation = action.operation ?? "created";
  return `${operation[0].toUpperCase()}${operation.slice(1)} ${action.kind}: ${action.name}.`;
}

const DEFAULT_CHAT_TITLES = new Set([
  "New workspace conversation",
  "New conversation",
  "Telegram Chat",
]);

export async function autoTitleChatForUser(
  ownerId: number,
  chatId: number
): Promise<void> {
  try {
    const chat = await getChatForUser(ownerId, chatId);
    if (!chat || !DEFAULT_CHAT_TITLES.has(chat.title)) return;
    const messages = await listChatMessagesForUser(ownerId, chatId);
    const firstUser = messages?.find(m => m.role === "user");
    const firstAssistant = messages?.find(
      m =>
        m.role === "assistant" &&
        !m.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX)
    );
    if (!firstUser || !firstAssistant) return;
    const computer = await getWorkspaceComputer(ownerId);
    const client = getE2BClient();
    if (!client) return;
    const prompt = [
      "Generate a concise 3-6 word title for this conversation. Reply with the title only — no quotes, no trailing punctuation.",
      firstUser.content,
      firstAssistant.content,
    ].join("\n");
    const result = await runOpencodeChatInPersistentSandbox(client, {
      workspaceId: computer.workspace.id,
      sandboxId: computer.workspace.persistentSandboxId,
      ownerId,
      model: ENV.opencodeZenModel,
      prompt: prompt.slice(0, 2000),
    });
    const raw = String(result.reply ?? "")
      .trim()
      .split("\n")[0]
      .replace(/^["']+|["']+$/g, "")
      .trim()
      .slice(0, 60);
    if (raw)
      await renameChatIfDefaultForUser(
        ownerId,
        chatId,
        raw,
        Array.from(DEFAULT_CHAT_TITLES)
      );
  } catch (error) {
    console.error("[Chat title] auto-title failed", error);
  }
}

async function runDirectWorkspaceAction(ownerId: number, content: string) {
  const computer = await getWorkspaceComputer(ownerId);
  const telegramMessage = content.match(
    /(?:send|post)\s+(?:a\s+)?telegram(?:\s+message)?(?:\s+saying|\s+with\s+text|:)\s*["']?(.+?)["']?\.?$/i
  );
  if (telegramMessage?.[1]?.trim()) {
    const credentials = await getTelegramCredentialsForUser(ownerId);
    if (!credentials?.chatId)
      return {
        reply:
          "Connect Telegram in Settings, send /start to your bot, and discover its chat before asking me to send a message.",
        actions: [] as AgentAction[],
      };
    const text = telegramMessage[1].trim().replace(/["']$/, "");
    const sent = await sendTelegramMessage(
      credentials.token,
      credentials.chatId,
      text
    );
    return {
      reply: `Sent your Telegram message (message #${sent.message_id}).`,
      actions: [
        { kind: "telegram" as const, name: text, operation: "sent" as const },
      ],
    };
  }
  const vmTask = content.match(
    /(?:use|run|start|launch)\s+(?:a\s+)?(?:e2b\s+)?(?:vm|sandbox)\s+(?:to|for)\s+(.+)/i
  );
  if (vmTask?.[1]?.trim()) {
    const started = await startAgentVmRun(ownerId, { task: vmTask[1].trim() });
    if (!started.configured)
      return {
        reply: started.message,
        actions: [
          { kind: "vm" as const, name: "E2B", operation: "disabled" as const },
        ],
      };
    return {
      reply: started.message,
      actions: [
        {
          kind: "vm" as const,
          name: `run #${started.run?.id ?? ""}`,
          operation: "completed" as const,
        },
      ],
    };
  }
  const renameFolder = content.match(
    /rename\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?\s+to\s+['"]?([^'".\n]+)['"]?/i
  );
  if (renameFolder?.[1] && renameFolder[2]) {
    const folder = computer.folders.find(
      item => item.name.toLowerCase() === renameFolder[1].trim().toLowerCase()
    );
    const updated =
      folder &&
      (await updateWorkspaceFolderForUser(ownerId, folder.id, {
        name: renameFolder[2].trim(),
      }));
    if (updated)
      return {
        reply: `Renamed the folder to **${updated.name}**.`,
        actions: [
          {
            kind: "folder" as const,
            name: updated.name,
            operation: "renamed" as const,
          },
        ],
      };
  }
  const moveFolder = content.match(
    /move\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?\s+(?:to|into)\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?/i
  );
  if (moveFolder?.[1] && moveFolder[2]) {
    const folder = computer.folders.find(
      item => item.name.toLowerCase() === moveFolder[1].trim().toLowerCase()
    );
    const destination = computer.folders.find(
      item => item.name.toLowerCase() === moveFolder[2].trim().toLowerCase()
    );
    const updated =
      folder &&
      destination &&
      folder.id !== destination.id &&
      (await updateWorkspaceFolderForUser(ownerId, folder.id, {
        parentId: destination.id,
      }));
    if (updated)
      return {
        reply: `Moved **${folder.name}** into **${destination.name}**.`,
        actions: [
          {
            kind: "folder" as const,
            name: folder.name,
            operation: "moved" as const,
          },
        ],
      };
  }
  const renameFile = content.match(
    /rename\s+(?:the\s+)?file\s+['"]?([\w.-]+)['"]?\s+to\s+['"]?([\w.-]+)['"]?/i
  );
  if (renameFile?.[1] && renameFile[2]) {
    const file = computer.files.find(
      item => item.name.toLowerCase() === renameFile[1].toLowerCase()
    );
    const updated =
      file &&
      (await updateWorkspaceFileForUser(ownerId, file.id, {
        name: renameFile[2],
      }));
    if (updated)
      return {
        reply: `Renamed **${file.name}** to **${updated.name}**.`,
        actions: [
          {
            kind: "file" as const,
            name: updated.name,
            operation: "renamed" as const,
          },
        ],
      };
  }
  const moveFile = content.match(
    /move\s+(?:the\s+)?file\s+['"]?([\w.-]+)['"]?\s+(?:to|into)\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?/i
  );
  if (moveFile?.[1] && moveFile[2]) {
    const file = computer.files.find(
      item => item.name.toLowerCase() === moveFile[1].toLowerCase()
    );
    const folder = computer.folders.find(
      item => item.name.toLowerCase() === moveFile[2].trim().toLowerCase()
    );
    const updated =
      file &&
      folder &&
      (await updateWorkspaceFileForUser(ownerId, file.id, {
        folderId: folder.id,
      }));
    if (updated)
      return {
        reply: `Moved **${file.name}** into **${folder.name}**.`,
        actions: [
          {
            kind: "file" as const,
            name: file.name,
            operation: "moved" as const,
          },
        ],
      };
  }
  const deleteFile = content.match(
    /(?:delete|remove)\s+(?:the\s+)?file\s+['"]?([\w-]+(?:\.[\w-]+)?)/i
  );
  if (deleteFile?.[1]) {
    const file = computer.files.find(
      item => item.name.toLowerCase() === deleteFile[1].toLowerCase()
    );
    if (file && (await deleteWorkspaceFileForUser(ownerId, file.id)))
      return {
        reply: `Deleted **${file.name}** from your private workspace.`,
        actions: [
          {
            kind: "file" as const,
            name: file.name,
            operation: "deleted" as const,
          },
        ],
      };
  }
  const deleteFolder = content.match(
    /(?:delete|remove)\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?/i
  );
  if (deleteFolder?.[1]) {
    const folder = computer.folders.find(
      item => item.name.toLowerCase() === deleteFolder[1].trim().toLowerCase()
    );
    if (folder && (await deleteWorkspaceFolderForUser(ownerId, folder.id)))
      return {
        reply: `Deleted the **${folder.name}** folder and its contents.`,
        actions: [
          {
            kind: "folder" as const,
            name: folder.name,
            operation: "deleted" as const,
          },
        ],
      };
  }
  const folder = content.match(
    /(?:create|make|add)\s+(?:a\s+)?folder\s+(?:named|called)\s+['"]?([^'".\n]+)['"]?/i
  );
  if (folder?.[1]?.trim()) {
    const created = await createWorkspaceFolderForUser(ownerId, {
      name: folder[1].trim(),
    });
    if (created)
      return {
        reply: `Created the **${created.name}** folder in your private workspace.`,
        actions: [{ kind: "folder" as const, name: created.name }],
      };
  }
  const file = content.match(
    /(?:create|make|add)\s+(?:a\s+)?(?:plain text\s+)?file\s+(?:named|called)\s+['"]?([\w.-]+)['"]?/i
  );
  if (file?.[1]?.trim()) {
    const exact =
      content.match(/(?:containing exactly|with content)\s*:?\s*(.+)$/i)?.[1] ??
      "";
    const created = await createWorkspaceFileForUser(ownerId, {
      name: file[1].trim(),
      content: exact,
    });
    if (created)
      return {
        reply: `Created **${created.name}** in your private workspace.`,
        actions: [{ kind: "file" as const, name: created.name }],
      };
  }
  return {
    reply: "",
    actions: [] as AgentAction[],
  };
}

const OPENCODE_STYLE_WORKSPACE_PROMPT = `You are Nova, an interactive software-engineering agent operating inside a private computer workspace.

Be concise, direct, and action-oriented. When the user asks you to perform work, use the available tools instead of merely describing what should be done. Do not claim that an action happened unless the corresponding tool succeeded.

Inspect before changing when the task requires understanding existing files or state. Prefer the smallest correct change and follow the existing codebase's conventions. Never expose secrets, tokens, credentials, or private data in responses. Do not invent tool results, file contents, command output, paths, or completion states.

Tool results are authoritative data from the workspace. For shell commands, treat the returned output field as the actual stdout/stderr result of the command. A tool activity/status message such as “Completed vm: bash: <command>” is only UI metadata and is never the command's output. If a command returns output, read and use that output. If it returns an error or non-zero exit code, acknowledge the failure and recover when possible.

Use shell commands for inspection, diagnostics, file operations, development commands, and other tasks when appropriate. The shell runs in Nova's dedicated sandbox, not on the user's local device. Do not run shell or VM tools merely to narrate progress. Do not send Telegram messages unless the user explicitly asks you to send the supplied message.
Continue working through tool calls when additional inspection or actions are necessary. If a task is complete, give the user the concise result. Match the user's language when practical.

Current folders: {{folders}}
Current files: {{files}}`;

export async function runWorkspaceAgent(
  ownerId: number,
  chatId: number,
  content: string,
  options: WorkspaceAgentOptions = {}
) {
  const emitTool = async (tool: WorkspaceToolActivity) => {
    try {
      await options.onEvent?.({ type: "tool", tool });
    } catch {}

    if (tool.state === "completed" || tool.state === "failed") {
      try {
        await appendChatMessageForUser(ownerId, {
          chatId,
          role: "assistant",
          content: `${TOOL_ACTIVITY_MESSAGE_PREFIX}${JSON.stringify(tool)}`,
        });
      } catch (error) {
        console.error("[Tool activity] failed to persist", error);
      }
    }
  };
  const emitDirectActions = async (actions: AgentAction[]) => {
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      await emitTool({
        id: `direct-${index}`,
        name: `workspace_${action.kind}`,
        state: action.operation === "disabled" ? "failed" : "completed",
        args: { name: action.name },
        summary: actionSummary(action),
      });
    }
  };

  await appendChatMessageForUser(ownerId, { chatId, role: "user", content });
  const computer = await getWorkspaceComputer(ownerId);
  const context = OPENCODE_STYLE_WORKSPACE_PROMPT.replace(
    "{{folders}}",
    computer.folders.map(folder => folder.name).join(", ") || "none"
  ).replace(
    "{{files}}",
    computer.files.map(file => file.name).join(", ") || "none"
  );

  // Explicit workspace actions (file/folder create-rename-move-delete, Telegram,
  // VM run) are resolved directly and need no model. Try them first so these
  // operations stay immediate and deterministic.
  const direct = await runDirectWorkspaceAction(ownerId, content);
  if (direct.actions.length > 0 || direct.reply.trim()) {
    await emitDirectActions(direct.actions);
    await options.onChunk?.(direct.reply);
    const message = await appendChatMessageForUser(ownerId, {
      chatId,
      role: "assistant",
      content: direct.reply,
    });
    return { message, actions: direct.actions };
  }

  // Conversational chat: run the full opencode agent inside the user's persistent
  // VM (big-pickle, anonymous OpenCode Zen provider), mirroring the Zo Computer
  // setup. The VM's opencode handles its own tools (bash, file edit, etc.). There
  // is no server-side model key — the VM is the model.
  const client = getE2BClient();
  if (client) {
    try {
      await persistWorkspaceToObjectStorage(ownerId);
      const sandbox = await ensurePersistentSandbox(
        client,
        computer.workspace.id,
        ownerId,
        computer.workspace.persistentSandboxId
      );
      await restoreWorkspaceToE2B(ownerId, sandbox);
      const result = await runOpencodeChatInPersistentSandbox(client, {
        workspaceId: computer.workspace.id,
        sandboxId: computer.workspace.persistentSandboxId,
        ownerId,
        model: ENV.opencodeZenModel,
        prompt: `${context}\n\n${content}`,
        onChunk: options.onChunk,
      });
      const completedSandbox = await client.connect(result.sandboxId);
      await persistE2BWorkspace(ownerId, completedSandbox);
      await persistWorkspaceToObjectStorage(ownerId);
      await updateWorkspacePersistentSandbox(
        computer.workspace.id,
        result.sandboxId
      );
      const reply = String(
        result.reply || "I’m ready to help with this workspace."
      ).trim();
      const message = await appendChatMessageForUser(ownerId, {
        chatId,
        role: "assistant",
        content: reply,
      });
      return { message, actions: [] };
    } catch (error) {
      console.error("[Chat] VM opencode chat failed", error);
    }
  }

  const reply =
    "Nova’s VM (openCode) isn’t available right now, so I couldn’t run the agent. Please try again shortly. Explicit workspace actions remain available.";
  await options.onChunk?.(reply);
  const message = await appendChatMessageForUser(ownerId, {
    chatId,
    role: "assistant",
    content: reply,
  });
  return { message, actions: [] };
}
