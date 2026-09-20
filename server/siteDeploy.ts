/** Nova's live website deployer.
 *
 * Publishes a chosen workspace directory as a static website on Netlify's
 * free tier: the directory's files (text or binary data-URI) are uploaded
 * with their folder structure intact relative to that directory, so its
 * index.html is the entry page. Each deployment is its own Netlify site with
 * a permanent free `<name>.netlify.app` subdomain, a stable ID (d-01, d-02,
 * ...) the agent targets it by, and a short description kept in the
 * workspace's deployment registry. A deployment's URL is never overridden:
 * the agent can only publish to a deployment by naming its ID explicitly, and
 * updating that ID keeps its URL while the content changes. The result is a
 * live, SSL-backed website that stays up 24/7 at no cost. */

import {
  getLatestSiteDeploymentForUser,
  getSiteDeploymentByKeyForUser,
  listSiteDeploymentRegistryForUser,
  listSiteDeploymentsForUser,
  markSiteDeploymentsDeletedForUser,
  nextSiteDeploymentKeyForUser,
  recordSiteDeployment,
  updateSiteDeploymentDescriptionForUser,
  updateSiteDeploymentStatusForUser,
  listWorkspaceFilesForUser,
  listWorkspaceFoldersForUser,
  type SiteDeploymentRegistryEntry,
  type SiteDeploymentRow,
} from "./db";
import {
  createNetlifySite,
  deleteNetlifySite,
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

export type DeployOptions = {
  /** The deployment ID to publish to, e.g. 'd-01'. Its URL never changes. Omit to create a new deployment. */
  deployment?: string;
  /** Short description of what this deployment is (required on EVERY deploy - it names the deployment's purpose in the registry). */
  description?: string;
};

/** Renders the workspace's deployment registry as one model-ready line for the system prompt. */
export async function describeDeploymentsForUser(ownerId: number): Promise<string> {
  const registry = await listSiteDeploymentRegistryForUser(ownerId);
  if (registry.length === 0) return "none yet - no website has ever been deployed from this workspace";
  return registry
    .map(entry =>
      `${entry.key} (${entry.status}, ${entry.siteUrl})` +
      `${entry.description ? ` - ${entry.description}` : " - no description"}`
    )
    .join("; ");
}

/**
 * Deploys the chosen directory as a live website - the directory's contents
 * become the site and its index.html is the entry page. `directory` is a
 * workspace-relative folder path; null/empty means the workspace root.
 *
 * A deployment URL is never overridden: publishing to an existing deployment
 * requires naming its ID in `options.deployment` (its URL stays the same
 * while the content updates); without an ID a brand-new deployment is
 * created, with its own site, URL and registry key. There is no implicit
 * "latest site" target - a different project never silently overwrites
 * another deployment's URL.
 */
export async function deployWorkspaceSite(
  ownerId: number,
  directory?: string | null,
  options?: DeployOptions
): Promise<DeployResult> {
  if (!isNetlifyConfigured()) {
    return { ok: false, message: "Live deployments are not configured yet - the Nova operator needs to set NETLIFY_API_TOKEN." };
  }

  const [files, folders] = await Promise.all([
    listWorkspaceFilesForUser(ownerId),
    listWorkspaceFoldersForUser(ownerId),
  ]);
  if (files.length === 0) {
    return { ok: false, message: "Your workspace is empty - create some files first (index.html is a good start)." };
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
      message: `There is nothing to deploy in ${dirLabel} - choose a directory that contains the site files.`,
    };
  }
  if (!selected.some(entry => sitePath(entry.siteSegments) === "/index.html")) {
    return {
      ok: false,
      message: `Add an index.html at the root of ${dirLabel} first - it is your website's entry page.`,
    };
  }

  const deployFiles: NetlifyDeployFile[] = selected.map(({ file, siteSegments }) => ({
    path: sitePath(siteSegments),
    content: fileBody(file.content),
  }));

  try {
    // Targeting: an explicit deployment ID publishes to that deployment (its
    // URL is never overridden); without an ID a brand-new deployment is
    // created - there is no implicit "latest site" target anymore.
    const requestedKey = options?.deployment?.trim();
    const description = options?.description?.trim() ?? "";
    if (!description) {
      return {
        ok: false,
        message:
          "A short description of this deployment is required on every deploy (e.g. 'portfolio site', 'bakery landing page') - it names the deployment's purpose, is kept in the workspace's deployment registry across chats, and is how you and the user tell deployments apart. Pass it as description.",
      };
    }
    let deploymentKey: string;
    let site: { id: string; name: string | null; url: string };
    let previousDescription: string | null = null;
    if (requestedKey) {
      const target = await getSiteDeploymentByKeyForUser(ownerId, requestedKey);
      if (!target) {
        const known = await describeDeploymentsForUser(ownerId);
        return {
          ok: false,
          message: `There is no deployment '${requestedKey}' in this workspace. Known deployments: ${known}. Pass an existing ID to update that deployment, or omit it to create a new one.`,
        };
      }
      if (target.status === "deleted") {
        return {
          ok: false,
          message: `Deployment ${target.key} (${target.siteUrl}) was deleted, so its URL is gone - it cannot be deployed to anymore. Create a new deployment instead (it will get a fresh ID and URL).`,
        };
      }
      deploymentKey = target.key;
      site = { id: target.siteId, name: target.siteName, url: target.siteUrl };
      previousDescription = target.description;
      if (description !== previousDescription) {
        await updateSiteDeploymentDescriptionForUser(ownerId, target.key, description);
      }
    } else {
      const key = await nextSiteDeploymentKeyForUser(ownerId);
      deploymentKey = key;
      site = await createNetlifySite();
    }
    if (!site.url) throw new Error("Netlify did not return a URL for the new site.");

    const deployment = await recordSiteDeployment(ownerId, {
      siteId: site.id,
      siteName: site.name,
      siteUrl: site.url,
      deploymentKey,
      description,
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


export type DeleteTarget = { key: string; siteId: string; siteUrl: string; description: string | null };

export type DeleteResult =
  | { ok: true; deleted: DeleteTarget[]; failed: number }
  | { ok: false; confirmationRequired: true; targets: DeleteTarget[]; message: string }
  | { ok: false; message: string };

function targetOf(entry: SiteDeploymentRegistryEntry): DeleteTarget {
  return { key: entry.key, siteId: entry.siteId, siteUrl: entry.siteUrl, description: entry.description };
}

/** How the model sees one registry entry when a target list is listed to it. */
function describeTarget(target: DeleteTarget): string {
  return `${target.key} (${target.siteUrl}${target.description ? ` - ${target.description}` : ""})`;
}

/**
 * Deletes one deployment (by its ID) or every deployment the workspace has.
 * Deletion is irreversible and the URL goes offline immediately; workspace
 * files are untouched. A single deployment is deleted by naming its ID - the
 * model resolves which ID from the deployment registry first and asks the
 * user when the request is ambiguous.
 *
 * `all: true` deletes every deployment - a sweep so destructive it keeps a
 * server-side confirmation gate: the first call only returns the target list,
 * and the sweep executes on a follow-up call whose `confirmAll` must match
 * the list of deployment IDs exactly (set equality, so it also catches a
 * target list that changed between the two calls).
 */
export async function deleteWorkspaceSite(
  ownerId: number,
  options?: { deployment?: string; all?: boolean; confirmAll?: string[] }
): Promise<DeleteResult> {
  if (!isNetlifyConfigured()) {
    return { ok: false, message: "Live deployments are not configured yet - the Nova operator needs to set NETLIFY_API_TOKEN." };
  }

  const registry = await listSiteDeploymentRegistryForUser(ownerId);
  if (registry.length === 0) {
    return { ok: false, message: "This workspace has no deployed websites to delete." };
  }

  let targets: DeleteTarget[];
  if (options?.all) {
    // The sweep gate: without a matching confirmation nothing is deleted.
    const allTargets = registry.map(targetOf);
    const confirmedKeys = (options.confirmAll ?? []).map(key => key.trim()).filter(Boolean);
    const targetKeys = allTargets.map(target => target.key);
    const confirmed =
      confirmedKeys.length === targetKeys.length && targetKeys.every(key => confirmedKeys.includes(key));
    if (!confirmed) {
      const reason = (options.confirmAll ?? []).length === 0
        ? "the sweep needs explicit confirmation first"
        : "the confirmed list does not match the current deployments exactly - it may be stale";
      return {
        ok: false,
        confirmationRequired: true,
        targets: allTargets,
        message:
          `Deleting every deployment is irreversible, so nothing was deleted yet (${reason}). ` +
          `The complete target list is: ${allTargets.map(describeTarget).join("; ")}. ` +
          `Re-call with all: true and confirm_all set to exactly these deployment IDs - and only after the user has explicitly confirmed deleting every one of them.`,
      };
    }
    targets = allTargets;
  } else {
    const requestedKey = options?.deployment?.trim();
    if (!requestedKey) {
      return {
        ok: false,
        message:
          `Name the deployment to delete by its ID. Known deployments: ${registry.map(describeTarget).join("; ")}. ` +
          `If the request is ambiguous, ask the user which one they mean first.`,
      };
    }
    const entry = registry.find(candidate => candidate.key.toLowerCase() === requestedKey.toLowerCase());
    if (!entry) {
      return {
        ok: false,
        message: `There is no deployment '${requestedKey}' in this workspace. Known deployments: ${registry.map(describeTarget).join("; ")}.`,
      };
    }
    if (entry.status === "deleted") {
      return { ok: false, message: `Deployment ${entry.key} (${entry.siteUrl}) is already deleted.` };
    }
    targets = [targetOf(entry)];
  }

  const deleted: DeleteTarget[] = [];
  const failures: Array<{ key: string; message: string }> = [];
  for (const target of targets) {
    try {
      await deleteNetlifySite(target.siteId);
      await markSiteDeploymentsDeletedForUser(ownerId, target.siteId);
      deleted.push(target);
    } catch (error) {
      failures.push({ key: target.key, message: error instanceof Error ? error.message : "The deletion failed." });
    }
  }
  if (deleted.length === 0) {
    return {
      ok: false,
      message: `No deployment was deleted: ${failures.map(f => `${f.key}: ${f.message}`).join("; ")}`,
    };
  }
  return { ok: true, deleted, failed: failures.length };
}
