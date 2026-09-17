/** Nova's live website deployer.
 *
 * Publishes the entire workspace as a static website on Netlify's free tier:
 * every file (text or binary data-URI) is uploaded with its workspace folder
 * path intact, so index.html is the entry page and subfolders keep their
 * structure. The first deploy creates a fresh Netlify site with a permanent
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

/** Builds "/folder/sub/file.ext" paths for every workspace file. */
function buildSitePaths(folders: FolderRow[], files: FileRow[]) {
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
    const path = `/${[...segments, file.name].map(encodeURIComponent).join("/")}`;
    return [file.id, path];
  }));
}

/** Workspace content as website body: plain text as UTF-8, data URIs decoded to bytes. */
function fileBody(content: string): Buffer {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(content);
  if (match && match[2]) return Buffer.from(match[3], "base64");
  if (match) return Buffer.from(decodeURIComponent(match[3]), "utf8");
  return Buffer.from(content, "utf8");
}

/**
 * Deploys the workspace as a live website. Reuses the workspace's Netlify site
 * when one exists, so the public URL never changes between deploys.
 */
export async function deployWorkspaceSite(ownerId: number): Promise<DeployResult> {
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
  const paths = buildSitePaths(folders as FolderRow[], files as FileRow[]);
  if (!files.some(file => paths.get(file.id) === "/index.html")) {
    return { ok: false, message: "Add an index.html file to your workspace first — it is your website's entry page." };
  }

  const deployFiles: NetlifyDeployFile[] = files.map(file => ({
    path: paths.get(file.id) ?? `/${encodeURIComponent(file.name)}`,
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
