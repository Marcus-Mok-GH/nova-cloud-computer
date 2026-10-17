/**
 * The workspace agent's plan tool family (create_plan/edit_plan). The two
 * plan tools write this conversation's ultraplan document. They are exposed
 * only on a /ultraplan turn (see ultraplanAllowsTool), so the plan is the one
 * thing a read-only planning pass may create. Called by the executor with the
 * per-call context built there.
 */
import { createWorkspaceFileForUser, updateWorkspaceFileForUser } from "../db";
import { planFileName } from "../ultraplan";
import { workspaceRelativePathOf } from "../workspace/paths";
import { unifiedDiff } from "../workspace/workspaceEdits";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolCreatePlan(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, folderRows, mirror, chatId, ownerId } = ctx;
  if (!chatId)
    return {
      ok: false,
      result:
        "The plan tools need a conversation context, which is missing on this run.",
    };
  const name = planFileName(chatId);
  const content = typeof args.content === "string" ? args.content : "";
  if (!content.trim())
    return { ok: false, result: "The plan content is required." };
  const existing = computer.files.find(
    file =>
      (file.folderId ?? null) === null &&
      file.name.toLowerCase() === name.toLowerCase()
  );
  if (existing)
    return {
      ok: false,
      result: `A plan already exists for this conversation (${name}). Read it and use edit_plan to replace it.`,
    };
  const created = await createWorkspaceFileForUser(ownerId, {
    name,
    content,
    folderId: null,
  });
  if (!created)
    return { ok: false, result: `Could not create ${name}.` };
  const createdPath = workspaceRelativePathOf(
    folderRows,
    created.name,
    created.folderId ?? null
  );
  if (createdPath)
    await mirror({ kind: "write_file", path: createdPath, content });
  return {
    ok: true,
    result: `Created the plan at ${created.name} (id ${created.id}).`,
    action: { kind: "file", name: created.name, operation: "created" },
  };
}

export async function toolEditPlan(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, folderRows, mirror, chatId, ownerId } = ctx;
  if (!chatId)
    return {
      ok: false,
      result:
        "The plan tools need a conversation context, which is missing on this run.",
    };
  const name = planFileName(chatId);
  const content = typeof args.content === "string" ? args.content : "";
  const file = computer.files.find(
    candidate =>
      (candidate.folderId ?? null) === null &&
      candidate.name.toLowerCase() === name.toLowerCase()
  );
  if (!file)
    return {
      ok: false,
      result: `No plan exists for this conversation yet (${name}). Use create_plan to write it.`,
    };
  const previousContent = String(file.content ?? "");
  const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
    content,
  });
  if (!updated) return { ok: false, result: `Could not edit ${file.name}.` };
  const editedPath = workspaceRelativePathOf(
    folderRows,
    file.name,
    file.folderId ?? null
  );
  if (editedPath)
    await mirror({ kind: "write_file", path: editedPath, content });
  return {
    ok: true,
    result: `Updated the plan ${file.name} (id ${file.id}).`,
    action: { kind: "file", name: file.name, operation: "updated" },
    diff: unifiedDiff(previousContent, content) || undefined,
  };
}
