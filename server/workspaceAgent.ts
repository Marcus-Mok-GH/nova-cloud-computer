import { invokeLLM } from "./_core/llm";
import {
  appendChatMessageForUser,
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  getWorkspaceComputer,
} from "./db";

type AgentAction = { kind: "folder" | "file"; name: string };

async function runDirectWorkspaceAction(ownerId: number, content: string) {
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
  return { reply: "I can create folders and plain-text files here. Try asking: “Create a folder called Notes” or “Create a plain text file named ideas.md containing exactly: …”", actions: [] as AgentAction[] };
}

const tools = [
  { type: "function", function: { name: "create_folder", description: "Create a private folder in the user's Nova workspace when requested.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "create_file", description: "Create a plain-text file in the user's Nova workspace when requested.", parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } } },
];

export async function runWorkspaceAgent(ownerId: number, chatId: number, content: string) {
  await appendChatMessageForUser(ownerId, { chatId, role: "user", content });
  if (!process.env.BUILT_IN_FORGE_API_KEY && !process.env.OPENAI_API_KEY) {
    const direct = await runDirectWorkspaceAction(ownerId, content);
    const message = await appendChatMessageForUser(ownerId, { chatId, role: "assistant", content: direct.reply });
    return { message, actions: direct.actions };
  }
  const computer = await getWorkspaceComputer(ownerId);
  const context = `You are Nova, a concise helpful agent inside a private computer workspace. You may create folders and plain-text files only when the user clearly asks. Current folders: ${computer.folders.map(folder => folder.name).join(", ") || "none"}. Current files: ${computer.files.map(file => file.name).join(", ") || "none"}. Explain completed actions briefly.`;
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
      const args = JSON.parse(call.function.arguments ?? "{}") as { name?: string; content?: string };
      if (!args.name?.trim()) continue;
      if (call.function.name === "create_folder") {
        const folder = await createWorkspaceFolderForUser(ownerId, { name: args.name.trim() });
        if (folder) actions.push({ kind: "folder", name: folder.name });
      }
      if (call.function.name === "create_file") {
        const file = await createWorkspaceFileForUser(ownerId, { name: args.name.trim(), content: args.content ?? "" });
        if (file) actions.push({ kind: "file", name: file.name });
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
