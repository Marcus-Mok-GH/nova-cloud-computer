/**
 * The workspace agent's memory tool family: search_memories, read_memory,
 * save_memory, delete_memory. An agent chat reads and writes its own scope;
 * the default assistant stays in the shared workspace scope. Both arrive
 * pre-resolved on the context.
 */
import {
  deleteMemoryForUser,
  readMemoryForUser,
  saveMemoryForUser,
  searchMemoriesForUser,
} from "../memories";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolSearchMemories(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId, memoryScope } = ctx;
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

export async function toolReadMemory(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId, memoryScope } = ctx;
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

export async function toolSaveMemory(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId, agentChat } = ctx;
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

export async function toolDeleteMemory(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId, memoryScope } = ctx;
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
