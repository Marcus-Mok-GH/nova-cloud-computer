/** Nova's live website deployer.
 *
 * Publishes a chosen workspace directory as a static website on Netlify's
 * free tier: the directory's files (text or binary data-URI) are uploaded
 * with their folder structure intact relative to that directory, so its
 * index.html is the entry page. The first deploy creates a fresh Netlify site with a permanent
 * free `<name>.netlify.app` subdomain; later deploys reuse that site so the
 * URL stays stable while the content updates. The result is a live, SSL-backed
 * website that stays up 24/7 at no cost. */

import {
  getLatestSiteDeploymentForUser,
  listSiteDeploymentsForUser,
  listWorkspaceFilesForUser,
  listWorkspaceFoldersForUser,
  recordSiteDeployment,
  updateSiteDeploymentStatusForUser,
  type SiteDeploymentRow,
} from "./db";
import {
  createNetlifySite,
  deployFilesToNetlifySite,
  isNetlifyConfigured,
  type NetlifyDeployFile,
} from "./netlify";

export type DeploymentStatus = {
  configured: boolean;
  latest: SiteDeploymentRow | null;
  history: SiteDeploymentRow[];
};

export type DeployResult =
  | { ok: true; deployment: SiteDeploymentRow }
  | { ok: false; message: string };

/** Status for the Deployments page: configuration + live site + recent runs. */
export async function getDeploymentStatusForUser(ownerId: number): Promise<DeploymentStatus> {
  const [latest, history] = await Promise.all([
    getLatestSiteDeploymentForUser(ownerId),
    listSiteDeploymentsForUser(ownerId),
  ]);
  return { configured: isNetlifyConfigured(), latest, history };
}

type FolderRow = { id: number; parentId: number | null; name: string };
type FileRow = { id: number; folderId: number | null; name: string; content: string };

/** Builds the decoded path segments for every workspace file: ["folder", "sub", "file.ext"]. */
function buildFileSegments(folders: FolderRow[], files: FileRow[]): Map<number, string[]> {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const folderPathCache = new Map<number, string[]>();
  const folderPath = (folderId: number, seen = new Set<number>()): string[] => {
    const cached = folderPathCache.get(folderId);
    if (cached) return cached;
    const folder = byId.get(folderId);
    if (!folder) return [];
    if (seen.has(folderId)) return []; // cycle guard: impossible, but never infinite
    seen.add(folderId);
    const parentPath = folder.parentId ? folderPath(folder.parentId, seen) : [];
    const path = [...parentPath, folder.name];
    folderPathCache.set(folderId, path);
    return path;
  };
  return new Map(files.map(file => {
    const segments = file.folderId ? folderPath(file.folderId) : [];
    return [file.id, [...segments, file.name]];
  }));
}

/** Encoded site path for a file's segments. */
function sitePath(segments: string[]): string {
  return `/${segments.map(encodeURIComponent).join("/")}`;
}

/** Normalizes a chosen deploy directory to decoded segments, e.g. "my-app/src" -> ["my-app", "src"]. "" is the workspace root. */
function directorySegments(directory: string | null | undefined): string[] {
  if (!directory) return [];
  return directory
    .split("/")
    .map(segment => segment.trim())
    .filter(Boolean);
}

/** True when a file's segments sit inside (or at) the chosen directory. */
function insideDirectory(fileSegments: string[], dirSegments: string[]): boolean {
  if (dirSegments.length === 0) return true;
  return (
    fileSegments.length > dirSegments.length &&
    dirSegments.every((segment, index) => segment.toLowerCase() === fileSegments[index]?.toLowerCase())
  );
}

/** Workspace content as website body: plain text as UTF-8, data URIs decoded to bytes. */
function fileBody(content: string): Buffer {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(content);
  if (match && match[2]) return Buffer.from(match[3], "base64");
  if (match) return Buffer.from(decodeURIComponent(match[3]), "utf8");
  return Buffer.from(content, "utf8");
}

/**
 * Deploys the chosen directory as a live website — the directory's contents
 * become the site and its index.html is the entry page. `directory` is a
 * workspace-relative folder path; null/empty means the workspace root.
 * Reuses the workspace's Netlify site when one exists, so the public URL
 * never changes between deploys.
 */
export async function deployWorkspaceSite(
  ownerId: number,
  directory?: string | null
): Promise<DeployResult> {
  if (!isNetlifyConfigured()) {
    return { ok: false, message: "Live deployments are not configured yet — the Nova operator needs to set NETLIFY_API_TOKEN." };
  }

  const [files, folders] = await Promise.all([
    listWorkspaceFilesForUser(ownerId),
    listWorkspaceFoldersForUser(ownerId),
  ]);
  if (files.length === 0) {
    return { ok: false, message: "Your workspace is empty — create some files first (index.html is a good start)." };
  }
  const dirSegments = directorySegments(directory);
  const segments = buildFileSegments(folders as FolderRow[], files as FileRow[]);
  const selected: Array<{ file: FileRow; siteSegments: string[] }> = [];
  segments.forEach((fileSegments, fileId) => {
    if (!insideDirectory(fileSegments, dirSegments)) return;
    selected.push({
      file: files.find(file => file.id === fileId)!,
      // Re-root: paths inside the chosen directory become the site's paths.
      siteSegments: fileSegments.slice(dirSegments.length),
    });
  });
  const dirLabel = dirSegments.length === 0 ? "the workspace root" : `/${dirSegments.join("/")}`;
  if (selected.length === 0) {
    return {
      ok: false,
      message: `There is nothing to deploy in ${dirLabel} — choose a directory that contains the site files.`,
    };
  }
  if (!selected.some(entry => sitePath(entry.siteSegments) === "/index.html")) {
    return {
      ok: false,
      message: `Add an index.html at the root of ${dirLabel} first — it is your website's entry page.`,
    };
  }

  const deployFiles: NetlifyDeployFile[] = selected.map(({ file, siteSegments }) => ({
    path: sitePath(siteSegments),
    content: fileBody(file.content),
  }));

  try {
    const previous = await getLatestSiteDeploymentForUser(ownerId);
    // Reuse the existing site so the live URL is stable across deploys.
    const site = previous
      ? { id: previous.siteId, name: previous.siteName, url: previous.siteUrl }
      : await createNetlifySite();
    if (!site.url) throw new Error("Netlify did not return a URL for the new site.");

    const deployment = await recordSiteDeployment(ownerId, {
      siteId: site.id,
      siteName: site.name,
      siteUrl: site.url,
      fileCount: deployFiles.length,
      status: "deploying",
    });
    try {
      await deployFilesToNetlifySite(site.id, deployFiles);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The deployment failed.";
      const failed = await updateSiteDeploymentStatusForUser(ownerId, deployment.id, "failed", message);
      return { ok: false, message: `The website deployment failed: ${message}${failed ? ` It is recorded in the deployment history.` : ""}` };
    }
    const live = await updateSiteDeploymentStatusForUser(ownerId, deployment.id, "live");
    return { ok: true, deployment: live ?? deployment };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The deployment failed unexpectedly." };
  }
}
