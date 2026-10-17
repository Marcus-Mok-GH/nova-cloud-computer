/**
 * The workspace agent's deployment tool family: deploy_website,
 * delete_website and create_project_template. Called by the executor with
 * the per-call context built there.
 */
import {
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
} from "../db";
import {
  PROJECT_TEMPLATE_KEYS,
  isProjectTemplateKey,
  renderProjectTemplate,
  slugifyProjectName,
} from "../projectTemplates";
import {
  deleteWorkspaceSite,
  deployWorkspaceSite,
} from "../siteDeploy";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolDeployWebsite(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const directory = str(args.directory);
  if (!directory)
    return {
      ok: false,
      result:
        "You must choose the directory to deploy. Pass '/' for the workspace root, or a workspace folder path like 'my-react-app' or 'my-next-app/out' - the directory whose contents are the site.",
    };
  const deploymentKey = str(args.deployment).trim();
  const description = str(args.description).trim();
  // Environment variables travel as NAMES only: the deployer resolves the
  // values server-side from the owner's saved set, so the model never
  // sees or invents a secret value.
  const environmentVariables = Array.isArray(args.environment_variables)
    ? args.environment_variables.map(name => String(name).trim()).filter(Boolean)
    : undefined;
  const outcome = await deployWorkspaceSite(
    ownerId,
    directory === "/" ? null : directory,
    {
      deployment: deploymentKey || undefined,
      description: description || undefined,
      environmentVariables,
    }
  );
  if (!outcome.ok)
    return {
      ok: false,
      result: `The website was not deployed: ${outcome.message}`,
      action: { kind: "deployment", name: "", operation: "failed" },
    };
  const fileCount = outcome.deployment.fileCount;
  const fromLine =
    directory === "/" ? "the workspace root" : `/${directory}`;
  const envLine =
    outcome.attachedEnvVars.length > 0
      ? ` Environment variables attached by name: ${outcome.attachedEnvVars.join(", ")} - their values were resolved server-side and stay private.`
      : "";
  return {
    ok: true,
    result: deploymentKey
      ? `Deployment ${outcome.deployment.deploymentKey} is live at ${outcome.deployment.siteUrl} - ${fileCount} file${fileCount === 1 ? "" : "s"} published from ${fromLine}. Its URL never changed: redeploying to the same ID always keeps the same URL.${envLine}`
      : `A brand-new deployment is live: ID ${outcome.deployment.deploymentKey}, ${outcome.deployment.siteUrl} - ${fileCount} file${fileCount === 1 ? "" : "s"} published from ${fromLine}. Tell the user the URL and the deployment ID - future deploys pass that ID to update this exact deployment, and its description ('${description}') is kept in the deployment registry across chats.${envLine}`,
    action: {
      kind: "deployment",
      name: outcome.deployment.siteUrl,
      operation: "deployed",
    },
  };
}

export async function toolDeleteWebsite(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const deleteAll = args.all === true;
  const deploymentKey = str(args.deployment).trim();
  const confirmAll = Array.isArray(args.confirm_all)
    ? args.confirm_all.map(key => String(key))
    : undefined;
  const outcome = await deleteWorkspaceSite(ownerId, {
    deployment: deploymentKey || undefined,
    all: deleteAll,
    confirmAll,
  });
  if (!outcome.ok && "confirmationRequired" in outcome) {
    // The sweep gate fired: nothing was deleted. Hand the model the exact
    // target list so it can confirm with the user and re-call bound to it.
    return {
      ok: true,
      result: `Nothing was deleted yet - deleting every deployment is irreversible and needs explicit confirmation. ${outcome.message}`,
      action: {
        kind: "deployment",
        name: outcome.targets.map(t => t.key).join(", "),
        operation: "presented",
      },
    };
  }
  if (!outcome.ok)
    return {
      ok: false,
      result: `No website was deleted: ${outcome.message}`,
      action: { kind: "deployment", name: "", operation: "failed" },
    };
  const listed = outcome.deleted
    .map(entry => `${entry.key} (${entry.siteUrl})`)
    .join(", ");
  const failedNote =
    outcome.failed > 0
      ? ` (${outcome.failed} other deployment${outcome.failed === 1 ? "" : "s"} failed to delete - check the deployment history)`
      : "";
  return {
    ok: true,
    result: `Deleted ${outcome.deleted.length === 1 ? `deployment ${listed}` : `${outcome.deleted.length} deployments: ${listed}`}. The URL${outcome.deleted.length === 1 ? " is" : "s are"} offline and the deletion is irreversible - but every workspace file is untouched, and a new deploy_website creates a fresh deployment with a new ID and URL. Tell the user plainly what went offline.${failedNote}`,
    action: {
      kind: "deployment",
      name: outcome.deleted.map(entry => entry.siteUrl).join(", "),
      operation: "deleted",
    },
  };
}

export async function toolCreateProjectTemplate(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, folderRows, ownerId } = ctx;
  const rawName = str(args.name);
  if (!rawName) return { ok: false, result: "A project name is required." };
  // No stack specified: the model decides, but if it omitted the template
  // entirely, scaffold the default stack - a real React project, not a
  // loose HTML file.
  const template =
    str(args.template).trim() === "" ? "react" : args.template;
  if (!isProjectTemplateKey(template))
    return {
      ok: false,
      result: `Unknown template: ${str(args.template)}. Supported templates: ${PROJECT_TEMPLATE_KEYS.join(", ")}.`,
    };
  const projectName = slugifyProjectName(rawName);
  const rendered = renderProjectTemplate(template, rawName);

  // Project folder at the workspace root - reuse it if it already exists.
  const existingProject = computer.folders.find(
    folder =>
      folder.parentId === null &&
      folder.name.toLowerCase() === projectName.toLowerCase()
  );
  // Reusing an existing folder only works when it is empty: the template
  // files would collide with whatever the earlier project left behind
  // (the workspace enforces one file per folder and name), and a raw
  // duplicate-key error helps nobody. Refuse with a message the model
  // can act on: different name, or delete the stale folder first.
  const staleDescendantIds = new Set<number>();
  if (existingProject) {
    // Template files land in nested subfolders (src/, out/), so collect
    // the project root plus every descendant before judging reuse: a
    // stale file anywhere beneath the root would collide with the
    // scaffold, and a same-name subfolder would be duplicated.
    staleDescendantIds.add(existingProject.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of folderRows) {
        if (
          folder.parentId != null &&
          staleDescendantIds.has(folder.parentId) &&
          !staleDescendantIds.has(folder.id)
        ) {
          staleDescendantIds.add(folder.id);
          grew = true;
        }
      }
    }
  }
  const hasStaleContent =
    existingProject !== undefined &&
    (folderRows.some(
      folder =>
        folder.id !== existingProject.id &&
        staleDescendantIds.has(folder.id)
    ) ||
      computer.files.some(
        file =>
          file.folderId != null && staleDescendantIds.has(file.folderId)
      ));
  if (existingProject && hasStaleContent) {
    return {
      ok: false,
      result:
        `A ${projectName} project folder already exists with files in it from an earlier project, so the ${template} template would collide with them. ` +
        `Scaffold with a different project name instead, or delete the ${projectName} folder first if the old project is no longer needed.`,
    };
  }
  const projectFolder =
    existingProject ??
    (await createWorkspaceFolderForUser(ownerId, {
      name: projectName,
      parentId: null,
    }));
  if (!projectFolder)
    return {
      ok: false,
      result: `Could not create the ${projectName} folder - it may already exist.`,
    };

  // Folder cache: relative path inside the project -> folder id.
  const folderIds = new Map<string, number>([["", projectFolder.id]]);
  const ensureFolder = async (
    relativePath: string
  ): Promise<number | null> => {
    let parentId = projectFolder.id;
    let pathSoFar = "";
    for (const segment of relativePath.split("/")) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
      const cached = folderIds.get(pathSoFar);
      if (cached) {
        parentId = cached;
        continue;
      }
      const existing = computer.folders.find(
        folder =>
          folder.parentId === parentId &&
          folder.name.toLowerCase() === segment.toLowerCase()
      );
      const folder =
        existing ??
        (await createWorkspaceFolderForUser(ownerId, {
          name: segment,
          parentId,
        }));
      if (!folder) return null;
      folderIds.set(pathSoFar, folder.id);
      parentId = folder.id;
    }
    return parentId;
  };

  const createdPaths: string[] = [];
  for (const file of rendered.files) {
    const lastSlash = file.path.lastIndexOf("/");
    const folderPath =
      lastSlash === -1 ? "" : file.path.slice(0, lastSlash);
    const fileName =
      lastSlash === -1 ? file.path : file.path.slice(lastSlash + 1);
    const folderId = await ensureFolder(folderPath);
    if (folderId === null)
      return {
        ok: false,
        result: `Could not create the folders for ${file.path} in ${projectName}.`,
      };
    const created = await createWorkspaceFileForUser(ownerId, {
      name: fileName,
      content: file.content,
      mimeType: file.mimeType,
      folderId,
    });
    if (!created)
      return {
        ok: false,
        result: `Could not create ${file.path} in the ${projectName} folder - a file with that name may already exist.`,
      };
    createdPaths.push(file.path);
  }

  const deployDirectory =
    rendered.deployRoot === "."
      ? projectName
      : `${projectName}/${rendered.deployRoot}`;
  return {
    ok: true,
    result: `Scaffolded the ${rawName} project (${template} template): ${createdPaths.length} files in the ${projectName} folder - ${createdPaths.join(", ")}. ${rendered.summary} When it is ready to go live, deploy_website with directory: ${deployDirectory}.`,
    action: { kind: "project", name: projectName, operation: "created" },
  };
}
