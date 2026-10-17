/**
 * The desktop-browse tool family. The desktop GUI runs in its own sandbox,
 * not the workspace VM, so this works even on a run whose VM failed to wake.
 */
import { runDesktopBrowseCommand } from "../desktopBrowser";
import { getE2BClient } from "../e2b";
import { updateWorkspaceBrowserSandbox } from "../db";
import { type ToolCtx, type ToolExecution } from "./types";
import { saveBrowseCapture } from "./capture";

export async function toolBrowse(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId, computer } = ctx;
  const command = str(args.command);
  if (!command)
    return {
      ok: false,
      result:
        "A desktop command is required, e.g. 'open https://example.com', 'screenshot', or 'click 420 260'.",
    };
  const browserClient = getE2BClient();
  if (!browserClient)
    return {
      ok: false,
      result:
        "The desktop browser is not set up on this workspace (E2B is not configured), so nothing was opened. Tell the user the browser needs the workspace's E2B sandbox configured first.",
      action: { kind: "browser", name: "browser", operation: "disabled" },
    };
  const browse = await runDesktopBrowseCommand({
    client: browserClient,
    ownerId,
    workspaceId: computer.workspace.id,
    command,
    sandboxId: computer.workspace.browserSandboxId,
    onSandboxCreated: sandboxId =>
      updateWorkspaceBrowserSandbox(computer.workspace.id, sandboxId),
  });
  const saved = browse.screenshot
    ? await saveBrowseCapture(ownerId, browse.screenshot)
    : "";
  const result = [browse.result, saved].filter(Boolean).join("\n\n");
  return {
    ok: browse.ok,
    result,
    detail: result.slice(0, 16000),
    ...(browse.screenshot?.attachable ? { screenshot: browse.screenshot } : {}),
    action: {
      kind: "browser",
      name: command.trim().split(/\s+/)[0].slice(0, 45) || "browser",
      operation: browse.ok ? "completed" : "failed",
    },
  };
}
