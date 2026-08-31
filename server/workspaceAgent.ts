import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
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
  getWorkspaceModelSettingsForUser,
  updateWorkspaceFileForUser,
  updateWorkspaceFolderForUser,
} from "./db";
import { sendTelegramMessage } from "./telegram";
import { startAgentVmRun } from "./agentVm";
import { getDaytonaClient, runBashCommandInPersistentSandbox } from "./daytona";

export type AgentAction = { kind: "folder" | "file" | "telegram" | "vm"; name: string; operation?: "created" | "renamed" | "moved" | "deleted" | "sent" | "completed" | "disabled" };

export type WorkspaceToolActivity = {
  id: string;
  name: string;
  state: "running" | "completed" | "failed";
  args: Record<string, string>;
  summary?: string;
};

type WorkspaceAgentOptions = {
  onEvent?: (event: { type: "tool"; tool: WorkspaceToolActivity }) => void | Promise<void>;
};

const VISIBLE_TOOL_ARGUMENTS = new Set(["name", "currentName", "newName", "folderName", "destinationName", "task", "command"]);

function visibleToolArguments(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args)
      .filter(([key]) => VISIBLE_TOOL_ARGUMENTS.has(key))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 160) : String(value).slice(0, 160)]),
  );
}

function actionSummary(action?: AgentAction) {
  if (!action) return "Nova could not complete this tool call.";
  if (action.operation === "disabled") return `${action.name} is not configured.`;
  const operation = action.operation ?? "created";
  return `${operation[0].toUpperCase()}${operation.slice(1)} ${action.kind}: ${action.name}.`;
}

const DEFAULT_WORKSPACE_AGENT_MODEL = "gpt-5-mini";
const workspaceAgentApiKey = () => process.env.NVIDIA_NIM_API_KEY || ENV.nvidiaNimApiKey;

type WorkspaceAgentConnection = {
  model: string;
  apiUrl?: string;
  apiKey?: string;
};

export async function getWorkspaceAgentConnection(ownerId: number): Promise<WorkspaceAgentConnection | undefined> {
  const settings = await getWorkspaceModelSettingsForUser(ownerId);
  const nvidiaApiKey = workspaceAgentApiKey();
  if ((settings?.activeProvider === "nvidia-nim" || nvidiaApiKey) && nvidiaApiKey) {
    return {
      model: process.env.NVIDIA_NIM_MODEL ?? "z-ai/glm-5.2",
      apiUrl: ENV.nvidiaNimApiUrl,
      apiKey: nvidiaApiKey,
    };
  }

  return undefined;
}

const DEFAULT_CHAT_TITLES = new Set(["New workspace conversation", "New conversation", "Telegram Chat"]);

/** Rename a still-default chat from its first user + assistant messages using the workspace LLM. No-op once titled, so later turns cost nothing. */
export async function autoTitleChatForUser(ownerId: number, chatId: number): Promise<void> {
  try {
    const chat = await getChatForUser(ownerId, chatId);
    if (!chat || !DEFAULT_CHAT_TITLES.has(chat.title)) return;
    const messages = await listChatMessagesForUser(ownerId, chatId);
    const firstUser = messages?.find(m => m.role === "user");
    const firstAssistant = messages?.find(m => m.role === "assistant");
    if (!firstUser || !firstAssistant) return;
    const connection = await getWorkspaceAgentConnection(ownerId);
    if (!connection) return;
    const result = await invokeLLM({
      ...agentInvokeOptions(connection),
      messages: [
        { role: "system", content: "Generate a concise 3-6 word title for this conversation. Reply with the title only — no quotes, no trailing punctuation." },
        { role: "user", content: `${firstUser.content}\n\n${firstAssistant.content}`.slice(0, 2000) },
      ],
      maxTokens: 20,
    });
    const raw = String(result?.choices?.[0]?.message?.content ?? "").trim().split("\n")[0].replace(/^["']+|["']+$/g, "").trim().slice(0, 60);
    if (raw) await renameChatIfDefaultForUser(ownerId, chatId, raw, Array.from(DEFAULT_CHAT_TITLES));
  } catch (error) {
    console.error("[Chat title] auto-title failed", error);
  }
}

function agentInvokeOptions(connection: WorkspaceAgentConnection) {
  return connection.apiUrl && connection.apiKey
    ? { model: connection.model, apiUrl: connection.apiUrl, apiKey: connection.apiKey }
    : { model: connection.model };
}

async function runDirectWorkspaceAction(ownerId: number, content: string) {
  const computer = await getWorkspaceComputer(ownerId);
  const telegramMessage = content.match(/(?:send|post)\s+(?:a\s+)?telegram(?:\s+message)?(?:\s+saying|\s+with\s+text|:)\s*["']?(.+?)["']?\.?$/i);
  if (telegramMessage?.[1]?.trim()) {
    const credentials = await getTelegramCredentialsForUser(ownerId);
    if (!credentials?.chatId) return { reply: "Connect Telegram in Settings, send /start to your bot, and discover its chat before asking me to send a message.", actions: [] as AgentAction[] };
    const text = telegramMessage[1].trim().replace(/["']$/, "");
    const sent = await sendTelegramMessage(credentials.token, credentials.chatId, text);
    return { reply: `Sent your Telegram message (message #${sent.message_id}).`, actions: [{ kind: "telegram" as const, name: text, operation: "sent" as const }] };
  }
  const vmTask = content.match(/(?:use|run|start|launch)\s+(?:a\s+)?(?:daytona\s+)?(?:vm|sandbox)\s+(?:to|for)\s+(.+)/i);
  if (vmTask?.[1]?.trim()) {
    const started = await startAgentVmRun(ownerId, { task: vmTask[1].trim() });
    if (!started.configured) return { reply: started.message, actions: [{ kind: "vm" as const, name: "Daytona", operation: "disabled" as const }] };
    return { reply: started.message, actions: [{ kind: "vm" as const, name: `run #${started.run?.id ?? ""}`, operation: "completed" as const }] };
  }
  const renameFolder = content.match(/rename\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?\s+to\s+['"]?([^'".\n]+)['"]?/i);
  if (renameFolder?.[1] && renameFolder[2]) {
    const folder = computer.folders.find(item => item.name.toLowerCase() === renameFolder[1].trim().toLowerCase());
    const updated = folder && await updateWorkspaceFolderForUser(ownerId, folder.id, { name: renameFolder[2].trim() });
    if (updated) return { reply: `Renamed the folder to **${updated.name}**.`, actions: [{ kind: "folder" as const, name: updated.name, operation: "renamed" as const }] };
  }
  const moveFolder = content.match(/move\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?\s+(?:to|into)\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?/i);
  if (moveFolder?.[1] && moveFolder[2]) {
    const folder = computer.folders.find(item => item.name.toLowerCase() === moveFolder[1].trim().toLowerCase());
    const destination = computer.folders.find(item => item.name.toLowerCase() === moveFolder[2].trim().toLowerCase());
    const updated = folder && destination && folder.id !== destination.id && await updateWorkspaceFolderForUser(ownerId, folder.id, { parentId: destination.id });
    if (updated) return { reply: `Moved **${folder.name}** into **${destination.name}**.`, actions: [{ kind: "folder" as const, name: folder.name, operation: "moved" as const }] };
  }
  const renameFile = content.match(/rename\s+(?:the\s+)?file\s+['"]?([\w.-]+)['"]?\s+to\s+['"]?([\w.-]+)['"]?/i);
  if (renameFile?.[1] && renameFile[2]) {
    const file = computer.files.find(item => item.name.toLowerCase() === renameFile[1].toLowerCase());
    const updated = file && await updateWorkspaceFileForUser(ownerId, file.id, { name: renameFile[2] });
    if (updated) return { reply: `Renamed **${file.name}** to **${updated.name}**.`, actions: [{ kind: "file" as const, name: updated.name, operation: "renamed" as const }] };
  }
  const moveFile = content.match(/move\s+(?:the\s+)?file\s+['"]?([\w.-]+)['"]?\s+(?:to|into)\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?/i);
  if (moveFile?.[1] && moveFile[2]) {
    const file = computer.files.find(item => item.name.toLowerCase() === moveFile[1].toLowerCase());
    const folder = computer.folders.find(item => item.name.toLowerCase() === moveFile[2].trim().toLowerCase());
    const updated = file && folder && await updateWorkspaceFileForUser(ownerId, file.id, { folderId: folder.id });
    if (updated) return { reply: `Moved **${file.name}** into **${folder.name}**.`, actions: [{ kind: "file" as const, name: file.name, operation: "moved" as const }] };
  }
  const deleteFile = content.match(/(?:delete|remove)\s+(?:the\s+)?file\s+['"]?([\w-]+(?:\.[\w-]+)?)/i);
  if (deleteFile?.[1]) {
    const file = computer.files.find(item => item.name.toLowerCase() === deleteFile[1].toLowerCase());
    if (file && await deleteWorkspaceFileForUser(ownerId, file.id)) return { reply: `Deleted **${file.name}** from your private workspace.`, actions: [{ kind: "file" as const, name: file.name, operation: "deleted" as const }] };
  }
  const deleteFolder = content.match(/(?:delete|remove)\s+(?:the\s+)?folder\s+['"]?([^'".\n]+)['"]?/i);
  if (deleteFolder?.[1]) {
    const folder = computer.folders.find(item => item.name.toLowerCase() === deleteFolder[1].trim().toLowerCase());
    if (folder && await deleteWorkspaceFolderForUser(ownerId, folder.id)) return { reply: `Deleted the **${folder.name}** folder and its contents.`, actions: [{ kind: "folder" as const, name: folder.name, operation: "deleted" as const }] };
  }
  const folder = content.match(/(?:create|make|add)\s+(?:a\s+)?folder\s+(?:named|called)\s+['"]?([^'".\n]+)['"]?/i);
  if (folder?.[1]?.trim()) {
    const created = await createWorkspaceFolderForUser(ownerId, { name: folder[1].trim() });
    if (created) return { reply: `Created the **${created.name}** folder in your private workspace.`, actions: [{ kind: "folder" as const, name: created.name }] };
  }
  const file = content.match(/(?:create|make|add)\s+(?:a\s+)?(?:plain text\s+)?file\s+(?:named|called)\s+['"]?([\w.-]+)['"]?/i);
  if (file?.[1]?.trim()) {
    const exact = content.match(/(?:containing exactly|with content)\s*:?\s*(.+)$/i)?.[1] ?? "";
    const created = await createWorkspaceFileForUser(ownerId, { name: file[1].trim(), content: exact });
    if (created) return { reply: `Created **${created.name}** in your private workspace.`, actions: [{ kind: "file" as const, name: created.name }] };
  }
  return { reply: "I can create, rename, move, and delete folders or plain-text files. You can also explicitly ask me to use a VM, for example: “Use a Daytona VM to inspect my workspace.”", actions: [] as AgentAction[] };
}

const tools = [
  { type: "function", function: { name: "create_folder", description: "Create a private folder in the user's Nova workspace when requested.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "create_file", description: "Create a plain-text file in the user's Nova workspace when requested.", parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } } },
  { type: "function", function: { name: "rename_file", description: "Rename an existing workspace file by exact current name.", parameters: { type: "object", properties: { currentName: { type: "string" }, newName: { type: "string" } }, required: ["currentName", "newName"] } } },
  { type: "function", function: { name: "delete_file", description: "Delete an existing workspace file by exact name when explicitly asked.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "move_file", description: "Move an existing workspace file into a named folder.", parameters: { type: "object", properties: { name: { type: "string" }, folderName: { type: "string" } }, required: ["name", "folderName"] } } },
  { type: "function", function: { name: "rename_folder", description: "Rename an existing workspace folder by exact current name.", parameters: { type: "object", properties: { currentName: { type: "string" }, newName: { type: "string" } }, required: ["currentName", "newName"] } } },
  { type: "function", function: { name: "move_folder", description: "Move an existing workspace folder into a different named folder.", parameters: { type: "object", properties: { name: { type: "string" }, destinationName: { type: "string" } }, required: ["name", "destinationName"] } } },
  { type: "function", function: { name: "delete_folder", description: "Delete an existing workspace folder and its contents when explicitly asked.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "send_telegram_message", description: "Send a Telegram message only when the user explicitly asks to send one.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
  { type: "function", function: { name: "run_workspace_vm", description: "Run a short, network-enabled Daytona VM task when the user explicitly asks to use a VM or sandbox. The VM is a dedicated sandbox (not the user's computer) and has internet access, so the supplied Python code may install packages and reach external services.", parameters: { type: "object", properties: { task: { type: "string" }, code: { type: "string" } }, required: ["task"] } } },
  { type: "function", function: { name: "run_bash_command", description: "Run one shell command inside the user's dedicated, network-enabled workspace VM. Use for inspection, CLI, install, or network tasks when the user asks you to use a shell or run a command. Output is returned for you to read. The VM is a sandboxed machine (not the user's computer), so commands may use the internet, install packages, or hit external services.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];

export async function runWorkspaceAgent(ownerId: number, chatId: number, content: string, options: WorkspaceAgentOptions = {}) {
  const emitTool = async (tool: WorkspaceToolActivity) => {
    try {
      await options.onEvent?.({ type: "tool", tool });
    } catch {
      // Tool activity must never interrupt the workspace action itself.
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
  const connection = await getWorkspaceAgentConnection(ownerId);
  if (!connection) {
    const direct = await runDirectWorkspaceAction(ownerId, content);
    const reply = direct.actions.length > 0
      ? direct.reply
      : "Nova’s AI model is not connected yet. Configure a server-side NVIDIA or managed model credential, then try again. Explicit workspace actions remain available while the model connection is offline.";
    await emitDirectActions(direct.actions);
    const message = await appendChatMessageForUser(ownerId, { chatId, role: "assistant", content: reply });
    return { message, actions: direct.actions };
  }
  const computer = await getWorkspaceComputer(ownerId);
  const context = `You are Nova, a concise helpful agent inside a private computer workspace. Use tools only for explicit create, rename, move, delete, Telegram-send, shell, or VM requests. Run a VM or a shell command only when the user specifically asks to use a VM, sandbox, or shell; the VM and shell run in a dedicated network-enabled sandbox (not the user's computer), so commands may use the internet. Send Telegram only if the user clearly asks you to send the supplied text. Current folders: ${computer.folders.map(folder => folder.name).join(", ") || "none"}. Current files: ${computer.files.map(file => file.name).join(", ") || "none"}. Explain completed actions briefly.`;
  let initial;
  try {
    initial = await invokeLLM({ ...agentInvokeOptions(connection), messages: [{ role: "system", content: context }, { role: "user", content }], tools: tools as any, toolChoice: "auto" });
  } catch {
    const direct = await runDirectWorkspaceAction(ownerId, content);
    await emitDirectActions(direct.actions);
    const message = await appendChatMessageForUser(ownerId, { chatId, role: "assistant", content: direct.reply });
    return { message, actions: direct.actions };
  }
  const choice = initial.choices[0]?.message as any;
  const toolCalls = choice?.tool_calls ?? [];
  const actions: AgentAction[] = [];
  const toolMessages: Array<{ role: "tool"; content: string; tool_call_id: string }> = [];

  for (const call of toolCalls.slice(0, 3)) {
    let args: { name?: string; content?: string; text?: string; currentName?: string; newName?: string; folderName?: string; destinationName?: string; task?: string; code?: string; command?: string } = {};
    const activity = {
      id: call.id,
      name: String(call.function.name),
      args: {} as Record<string, string>,
    };

    let bashOutput: string | undefined;

    try {
      args = JSON.parse(call.function.arguments ?? "{}") as typeof args;
      activity.args = visibleToolArguments(args);
      await emitTool({ ...activity, state: "running" });
      const actionCount = actions.length;
      if (call.function.name === "create_folder") {
        const folder = args.name?.trim() ? await createWorkspaceFolderForUser(ownerId, { name: args.name.trim() }) : undefined;
        if (folder) actions.push({ kind: "folder", name: folder.name });
      }
      if (call.function.name === "create_file") {
        const file = args.name?.trim() ? await createWorkspaceFileForUser(ownerId, { name: args.name.trim(), content: args.content ?? "" }) : undefined;
        if (file) actions.push({ kind: "file", name: file.name });
      }
      if (call.function.name === "rename_file") {
        const computer = await getWorkspaceComputer(ownerId);
        const file = computer.files.find(item => item.name === args.currentName);
        const updated = file && args.newName ? await updateWorkspaceFileForUser(ownerId, file.id, { name: args.newName }) : undefined;
        if (updated) actions.push({ kind: "file", name: updated.name, operation: "renamed" });
      }
      if (call.function.name === "delete_file") {
        const computer = await getWorkspaceComputer(ownerId);
        const file = computer.files.find(item => item.name === args.name);
        if (file && await deleteWorkspaceFileForUser(ownerId, file.id)) actions.push({ kind: "file", name: file.name, operation: "deleted" });
      }
      if (call.function.name === "move_file") {
        const computer = await getWorkspaceComputer(ownerId);
        const file = computer.files.find(item => item.name === args.name);
        const folder = computer.folders.find(item => item.name === args.folderName);
        if (file && folder && await updateWorkspaceFileForUser(ownerId, file.id, { folderId: folder.id })) actions.push({ kind: "file", name: file.name, operation: "moved" });
      }
      if (call.function.name === "rename_folder") {
        const computer = await getWorkspaceComputer(ownerId);
        const folder = computer.folders.find(item => item.name === args.currentName);
        const updated = folder && args.newName ? await updateWorkspaceFolderForUser(ownerId, folder.id, { name: args.newName }) : undefined;
        if (updated) actions.push({ kind: "folder", name: updated.name, operation: "renamed" });
      }
      if (call.function.name === "move_folder") {
        const computer = await getWorkspaceComputer(ownerId);
        const folder = computer.folders.find(item => item.name === args.name);
        const destination = computer.folders.find(item => item.name === args.destinationName);
        if (folder && destination && folder.id !== destination.id && await updateWorkspaceFolderForUser(ownerId, folder.id, { parentId: destination.id })) actions.push({ kind: "folder", name: folder.name, operation: "moved" });
      }
      if (call.function.name === "delete_folder") {
        const computer = await getWorkspaceComputer(ownerId);
        const folder = computer.folders.find(item => item.name === args.name);
        if (folder && await deleteWorkspaceFolderForUser(ownerId, folder.id)) actions.push({ kind: "folder", name: folder.name, operation: "deleted" });
      }
      if (call.function.name === "send_telegram_message") {
        const credentials = await getTelegramCredentialsForUser(ownerId);
        if (!credentials?.chatId || !args.text?.trim()) throw new Error("Telegram is not ready");
        const sent = await sendTelegramMessage(credentials.token, credentials.chatId, args.text.trim());
        actions.push({ kind: "telegram", name: `message #${sent.message_id}`, operation: "sent" });
      }
      if (call.function.name === "run_workspace_vm") {
        if (!args.task?.trim()) throw new Error("A VM task is required");
        const started = await startAgentVmRun(ownerId, { task: args.task.trim(), code: args.code });
        actions.push({ kind: "vm", name: started.run ? `run #${started.run.id}` : "Daytona", operation: started.configured ? "completed" : "disabled" });
      }
      if (call.function.name === "run_bash_command") {
        if (!args.command?.trim()) throw new Error("A shell command is required");
        const client = getDaytonaClient();
        if (!client) {
          actions.push({ kind: "vm", name: "Daytona", operation: "disabled" });
        } else {
          const computer = await getWorkspaceComputer(ownerId);
          const result = await runBashCommandInPersistentSandbox(client, { workspaceId: computer.workspace.id, ownerId, command: args.command.trim() });
          bashOutput = result.output;
          actions.push({ kind: "vm", name: `bash: ${args.command.trim().slice(0, 120)}`, operation: "completed" });
        }
      }

      const action = actions[actionCount];
      const succeeded = Boolean(action) && action.operation !== "disabled";
      await emitTool({ ...activity, state: succeeded ? "completed" : "failed", summary: actionSummary(action) });
      const toolContent = bashOutput !== undefined ? JSON.stringify({ ok: succeeded, output: bashOutput }) : JSON.stringify({ ok: succeeded });
      toolMessages.push({ role: "tool", tool_call_id: call.id, content: toolContent });
    } catch {
      await emitTool({ ...activity, state: "failed", summary: "Nova could not complete this tool call." });
      toolMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false }) });
    }
  }
  const final = toolCalls.length
    ? await invokeLLM({ ...agentInvokeOptions(connection), messages: [{ role: "system", content: context }, { role: "user", content }, choice, ...toolMessages] })
    : initial;
  const reply = String(final.choices[0]?.message?.content ?? "I’m ready to help with this workspace.");
  const message = await appendChatMessageForUser(ownerId, { chatId, role: "assistant", content: reply });
  return { message, actions };
}
