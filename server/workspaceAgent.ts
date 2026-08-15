import { invokeLLM } from "./_core/llm";
import {
  appendChatMessageForUser,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  deleteWorkspaceFileForUser,
  deleteWorkspaceFolderForUser,
  getWorkspaceComputer,
  getTelegramCredentialsForUser,
  updateWorkspaceFileForUser,
  updateWorkspaceFolderForUser,
} from "./db";
import { sendTelegramMessage } from "./telegram";

type AgentAction = { kind: "folder" | "file" | "telegram"; name: string; operation?: "created" | "renamed" | "moved" | "deleted" | "sent" };

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
  return { reply: "I can create, rename, move, and delete folders or plain-text files. Once you connect Telegram in Settings, you can also say: “Send Telegram: Project update is ready.”", actions: [] as AgentAction[] };
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
];

export async function runWorkspaceAgent(ownerId: number, chatId: number, content: string) {
  await appendChatMessageForUser(ownerId, { chatId, role: "user", content });
  if (!process.env.BUILT_IN_FORGE_API_KEY && !process.env.OPENAI_API_KEY) {
    const direct = await runDirectWorkspaceAction(ownerId, content);
    const message = await appendChatMessageForUser(ownerId, { chatId, role: "assistant", content: direct.reply });
    return { message, actions: direct.actions };
  }
  const computer = await getWorkspaceComputer(ownerId);
  const context = `You are Nova, a concise helpful agent inside a private computer workspace. Use tools only for explicit create, rename, move, delete, or Telegram-send requests. Send Telegram only if the user clearly asks you to send the supplied text. Current folders: ${computer.folders.map(folder => folder.name).join(", ") || "none"}. Current files: ${computer.files.map(file => file.name).join(", ") || "none"}. Explain completed actions briefly.`;
  let initial;
  try {
    initial = await invokeLLM({ model: "gpt-5-mini", messages: [{ role: "system", content: context }, { role: "user", content }], tools: tools as any, toolChoice: "auto" });
  } catch {
    const direct = await runDirectWorkspaceAction(ownerId, content);
    const message = await appendChatMessageForUser(ownerId, { chatId, role: "assistant", content: direct.reply });
    return { message, actions: direct.actions };
  }
  const choice = initial.choices[0]?.message as any;
  const toolCalls = choice?.tool_calls ?? [];
  const actions: AgentAction[] = [];
  const toolMessages: Array<{ role: "tool"; content: string; tool_call_id: string }> = [];

  for (const call of toolCalls.slice(0, 3)) {
    try {
      const args = JSON.parse(call.function.arguments ?? "{}") as { name?: string; content?: string; text?: string; currentName?: string; newName?: string; folderName?: string; destinationName?: string };
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
      toolMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
    } catch {
      toolMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false }) });
    }
  }
  const final = toolCalls.length
    ? await invokeLLM({ model: "gpt-5-mini", messages: [{ role: "system", content: context }, { role: "user", content }, choice, ...toolMessages] })
    : initial;
  const reply = String(final.choices[0]?.message?.content ?? "I’m ready to help with this workspace.");
  const message = await appendChatMessageForUser(ownerId, { chatId, role: "assistant", content: reply });
  return { message, actions };
}
