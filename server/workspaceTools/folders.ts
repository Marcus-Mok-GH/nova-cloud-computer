/**
 * The workspace agent's folder tool family: create/rename/move/delete.
 * Called by the executor for the corresponding tool names, with the
 * per-call context built there.
 */
import {
  createWorkspaceFolderForUser,
  deleteWorkspaceFolderForUser,
  updateWorkspaceFolderForUser,
} from "../db";
import { folderPathOf } from "../sandboxWorkspace";
import { folderNotFound, nameTakenAtLevel, resolveFolder } from "./resolve";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolCreateFolder(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, folderRows, mirror, ownerId } = ctx;
  const name = str(args.name);
  if (!name) return { ok: false, result: "A folder name is required." };
  const parent =
    args.parent !== undefined
      ? resolveFolder(ctx.computer, args.parent)
      : undefined;
  if (args.parent !== undefined && !parent)
    return folderNotFound(args.parent, "Parent folder");
  // Same-name siblings created ambiguity the agent cannot see: a later
  // create_file by folder name resolves to whichever folder came first,
  // so a workspace ends up with two same-named folders. Refuse up front.
  if (
    nameTakenAtLevel(
      folderRows,
      name,
      folder => folder.parentId ?? null,
      parent?.id ?? null
    )
  ) {
    return {
      ok: false,
      result: `A folder named ${name} already exists in that location. Use a different name, or work in the existing ${name} folder instead.`,
    };
  }
  const created = await createWorkspaceFolderForUser(ownerId, {
    name,
    parentId: parent?.id ?? null,
  });
  if (!created)
    return {
      ok: false,
      result: `Could not create the folder - ${name} may already exist.`,
    };
  const parentPath = folderPathOf(folderRows, created.parentId ?? null);
  const newFolderPath = parentPath
    ? `${parentPath}/${created.name}`
    : created.name;
  await mirror({ kind: "create_folder", path: newFolderPath });
  return {
    ok: true,
    result: `Created the ${created.name} folder (id ${created.id}).`,
    action: { kind: "folder", name: created.name, operation: "created" },
  };
}

export async function toolRenameFolder(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, folderRows, mirror, ownerId } = ctx;
  const folder = resolveFolder(computer, args.folder);
  const newName = str(args.new_name);
  if (!folder) return folderNotFound(args.folder);
  if (!newName)
    return { ok: false, result: "A new folder name is required." };
  const updated = await updateWorkspaceFolderForUser(ownerId, folder.id, {
    name: newName,
  });
  if (!updated)
    return {
      ok: false,
      result: `Could not rename ${folder.name} - ${newName} may already exist.`,
    };
  const folderRenameFrom = folderPathOf(folderRows, folder.id);
  const folderRenameParent = folderPathOf(
    folderRows,
    folder.parentId ?? null
  );
  const folderRenameTo = folderRenameFrom
    ? folderRenameParent
      ? `${folderRenameParent}/${newName}`
      : newName
    : null;
  if (folderRenameFrom && folderRenameTo)
    await mirror({
      kind: "move_path",
      from: folderRenameFrom,
      to: folderRenameTo,
    });
  return {
    ok: true,
    result: `Renamed ${folder.name} to ${updated.name}.`,
    action: { kind: "folder", name: updated.name, operation: "renamed" },
  };
}

export async function toolMoveFolder(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, folderRows, mirror, ownerId } = ctx;
  const folder = resolveFolder(computer, args.folder);
  const parent = resolveFolder(computer, args.parent);
  if (!folder) return folderNotFound(args.folder);
  if (!parent) return folderNotFound(args.parent, "Parent folder");
  if (folder.id === parent.id)
    return { ok: false, result: "A folder cannot be moved into itself." };
  const updated = await updateWorkspaceFolderForUser(ownerId, folder.id, {
    parentId: parent.id,
  });
  if (!updated)
    return { ok: false, result: `Could not move ${folder.name}.` };
  const folderMoveFrom = folderPathOf(folderRows, folder.id);
  const folderMoveParent = folderPathOf(folderRows, parent.id);
  const folderMoveTo =
    folderMoveFrom && folderMoveParent
      ? `${folderMoveParent}/${folderMoveFrom.split("/").pop()}`
      : null;
  if (folderMoveFrom && folderMoveTo)
    await mirror({
      kind: "move_path",
      from: folderMoveFrom,
      to: folderMoveTo,
    });
  return {
    ok: true,
    result: `Moved ${folder.name} into ${parent.name}.`,
    action: { kind: "folder", name: folder.name, operation: "moved" },
  };
}

export async function toolDeleteFolder(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, folderRows, mirror, ownerId } = ctx;
  const folder = resolveFolder(computer, args.folder);
  if (!folder) return folderNotFound(args.folder);
  if (!(await deleteWorkspaceFolderForUser(ownerId, folder.id)))
    return { ok: false, result: `Could not delete ${folder.name}.` };
  const removedFolderPath = folderPathOf(folderRows, folder.id);
  if (removedFolderPath)
    await mirror({ kind: "delete_folder", path: removedFolderPath });
  return {
    ok: true,
    result: `Deleted the ${folder.name} folder and its contents.`,
    action: { kind: "folder", name: folder.name, operation: "deleted" },
  };
}
