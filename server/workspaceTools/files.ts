/**
 * The workspace agent's file tool family: create/read/edit/rename/move/
 * delete. Called by the executor for the corresponding tool names, with the
 * per-call context built there.
 */
import {
  createWorkspaceFileForUser,
  deleteWorkspaceFileForUser,
  updateWorkspaceFileForUser,
} from "../db";
import { folderPathOf, workspaceRelativePathOf } from "../workspace/paths";
import { isCodeFileName, isSubstantialCode, unifiedDiff } from "../workspace/workspaceEdits";
import {
  fileNotFoundResult,
  folderNotFound,
  nameTakenAtLevel,
  resolveFile,
  resolveFolder,
} from "./resolve";
import {
  type ToolCtx,
  type ToolExecution,
  SPECIALIST_DOWN_BLOCK_RESULT,
} from "./types";

export async function toolCreateFile(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, folderRows, mirror, gate, ownerId } = ctx;
  const name = str(args.name);
  if (!name) return { ok: false, result: "A file name is required." };
  // Root-level names bypass the database unique constraint (NULL
  // folderId rows never collide in Postgres), so the guard lives here:
  // one file per name at the same level, case-insensitive like folders.
  const targetFolder =
    args.folder !== undefined
      ? resolveFolder(computer, args.folder)
      : undefined;
  if (args.folder !== undefined && !targetFolder)
    return folderNotFound(args.folder);
  if (
    nameTakenAtLevel(
      computer.files,
      name,
      file => file.folderId ?? null,
      targetFolder?.id ?? null
    )
  ) {
    return {
      ok: false,
      result: `A file named ${name} already exists in that location${targetFolder ? "" : " (workspace root)"}. Edit the existing file instead, or delete it first.`,
    };
  }
  if (
    gate?.blocked &&
    isCodeFileName(name) &&
    isSubstantialCode(str(args.content))
  ) {
    return {
      ok: false,
      result: SPECIALIST_DOWN_BLOCK_RESULT,
      action: {
        kind: "tool",
        name: `create_file: ${name}`,
        operation: "failed",
      },
    };
  }
  const created = await createWorkspaceFileForUser(ownerId, {
    name,
    content: str(args.content),
    folderId: targetFolder?.id ?? null,
  });
  if (!created)
    return {
      ok: false,
      result: `Could not create the file - a file named ${name} may already exist.`,
    };
  const createdPath = workspaceRelativePathOf(
    folderRows,
    created.name,
    created.folderId ?? null
  );
  if (createdPath)
    await mirror({
      kind: "write_file",
      path: createdPath,
      content: str(args.content),
    });
  return {
    ok: true,
    result: `Created ${created.name} (id ${created.id}).`,
    action: { kind: "file", name: created.name, operation: "created" },
  };
}

export async function toolReadFile(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args } = ctx;
  const file = resolveFile(computer, args.file);
  if (!file)
    return { ok: false, result: fileNotFoundResult(computer, args.file) };
  return {
    ok: true,
    result: `Content of ${file.name} (id ${file.id}):\n${String(file.content ?? "").slice(0, 20000)}`,
  };
}

export async function toolEditFile(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, folderRows, mirror, gate, ownerId } = ctx;
  const file = resolveFile(computer, args.file, { strict: true });
  if (!file)
    return { ok: false, result: fileNotFoundResult(computer, args.file) };
  const content = typeof args.content === "string" ? args.content : "";
  const previousContent = String(file.content ?? "");
  if (
    gate?.blocked &&
    isCodeFileName(file.name) &&
    isSubstantialCode(content)
  ) {
    return {
      ok: false,
      result: SPECIALIST_DOWN_BLOCK_RESULT,
      action: {
        kind: "tool",
        name: `edit_file: ${file.name}`,
        operation: "failed",
      },
    };
  }
  const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
    content,
  });
  if (!updated)
    return { ok: false, result: `Could not edit ${file.name}.` };
  const editedPath = workspaceRelativePathOf(
    folderRows,
    file.name,
    file.folderId ?? null
  );
  if (editedPath)
    await mirror({ kind: "write_file", path: editedPath, content });
  return {
    ok: true,
    result: `Updated ${file.name} (id ${file.id}).`,
    action: { kind: "file", name: file.name, operation: "updated" },
    // The dropdown shows what actually changed; an unchanged write has
    // no diff worth surfacing.
    diff: unifiedDiff(previousContent, content) || undefined,
  };
}

export async function toolRenameFile(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, folderRows, mirror, ownerId } = ctx;
  const file = resolveFile(computer, args.file, { strict: true });
  const newName = str(args.new_name);
  if (!file)
    return { ok: false, result: fileNotFoundResult(computer, args.file) };
  if (!newName)
    return { ok: false, result: "A new file name is required." };
  // Same root-level constraint as create_file: renames onto an existing
  // name never hit the database guard when the folder is NULL.
  if (
    nameTakenAtLevel(
      computer.files,
      newName,
      other => other.folderId ?? null,
      file.folderId ?? null,
      file.id
    )
  )
    return {
      ok: false,
      result: `A file named ${newName} already exists in that location. Pick a different name, or delete the other file first.`,
    };
  const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
    name: newName,
  });
  if (!updated)
    return {
      ok: false,
      result: `Could not rename ${file.name} - ${newName} may already exist.`,
    };
  const renameFrom = workspaceRelativePathOf(
    folderRows,
    file.name,
    file.folderId ?? null
  );
  const renameTo = workspaceRelativePathOf(
    folderRows,
    newName,
    file.folderId ?? null
  );
  if (renameFrom && renameTo)
    await mirror({ kind: "move_path", from: renameFrom, to: renameTo });
  return {
    ok: true,
    result: `Renamed ${file.name} to ${updated.name}.`,
    action: { kind: "file", name: updated.name, operation: "renamed" },
  };
}

export async function toolMoveFile(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, folderRows, mirror, ownerId } = ctx;
  const file = resolveFile(computer, args.file, { strict: true });
  const folder = resolveFolder(computer, args.folder);
  if (!file)
    return { ok: false, result: fileNotFoundResult(computer, args.file) };
  if (!folder) return folderNotFound(args.folder);
  if (
    nameTakenAtLevel(
      computer.files,
      file.name,
      other => other.folderId ?? null,
      folder.id,
      file.id
    )
  )
    return {
      ok: false,
      result: `A file named ${file.name} already exists in ${folder.name}. Rename one of them first, or delete the other file.`,
    };
  const updated = await updateWorkspaceFileForUser(ownerId, file.id, {
    folderId: folder.id,
  });
  if (!updated)
    return { ok: false, result: `Could not move ${file.name}.` };
  const moveFrom = workspaceRelativePathOf(
    folderRows,
    file.name,
    file.folderId ?? null
  );
  const parentPath = folderPathOf(folderRows, folder.id);
  const moveTo =
    moveFrom && parentPath
      ? `${parentPath}/${moveFrom.split("/").pop()}`
      : null;
  if (moveFrom && moveTo)
    await mirror({ kind: "move_path", from: moveFrom, to: moveTo });
  return {
    ok: true,
    result: `Moved ${file.name} into ${folder.name}.`,
    action: { kind: "file", name: file.name, operation: "moved" },
  };
}

export async function toolDeleteFile(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, folderRows, mirror, ownerId } = ctx;
  const file = resolveFile(computer, args.file, { strict: true });
  if (!file)
    return { ok: false, result: fileNotFoundResult(computer, args.file) };
  if (!(await deleteWorkspaceFileForUser(ownerId, file.id)))
    return { ok: false, result: `Could not delete ${file.name}.` };
  const deletedPath = workspaceRelativePathOf(
    folderRows,
    file.name,
    file.folderId ?? null
  );
  if (deletedPath) await mirror({ kind: "delete_file", path: deletedPath });
  return {
    ok: true,
    result: `Deleted ${file.name}.`,
    action: { kind: "file", name: file.name, operation: "deleted" },
  };
}
