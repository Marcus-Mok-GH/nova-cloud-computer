import { ensureRootFolder } from "./workspaceFolders";

/**
 * Chat/Telegram uploads land here so the workspace root stays reserved for the
 * user's own work: transient attachments are context for one turn, not files to
 * keep. The folder is created lazily on the first upload.
 */
export const UPLOADS_FOLDER = "temp";

/** Finds (or lazily creates) the single root-level uploads folder. */
export async function uploadsFolderId(ownerId: number): Promise<number | null> {
  return ensureRootFolder(ownerId, UPLOADS_FOLDER);
}

/** The path the agent sees for an uploaded file, e.g. `temp/report.pdf`. */
export function uploadsPath(name: string): string {
  return `${UPLOADS_FOLDER}/${name}`;
}
