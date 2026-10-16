import type { DesktopCapture } from "../desktopBrowser";
import { createWorkspaceFileForUser } from "../db";

/**
 * Saves a desktop capture into the workspace as a PNG file, so the user can
 * open what the agent was looking at. The content is the base64 data URI, the
 * same shape chat image attachments use.
 */
export async function saveBrowseCapture(ownerId: number, capture: DesktopCapture) {
  const attempt = async (name: string) => {
    const created = await createWorkspaceFileForUser(ownerId, {
      name,
      content: capture.dataUri,
      mimeType: "image/png",
    });
    return created
      ? `Saved to the workspace as "${created.name}" (file id ${created.id}).`
      : "";
  };
  const saved = await attempt(browseCaptureFileName(capture.suggestedName));
  if (saved) return saved;
  // A second capture in the same second under the same name: retry once with a
  // unique suffix rather than reporting a failure for work that did happen.
  const unique = await attempt(
    browseCaptureFileName(capture.suggestedName, Date.now(), true)
  );
  return (
    unique ||
    "The screenshot could not be saved to the workspace - tell the user it is not among their files."
  );
}

/**
 * `desktop-20261015143210.png`, or the name the model asked for with its
 * extension normalized and made filesystem-safe. Timestamped so successive
 * captures of the same page do not collide.
 */
export function browseCaptureFileName(
  suggested: string | undefined,
  atMs = Date.now(),
  unique = false
) {
  const stamp = new Date(atMs).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const base =
    (suggested ?? "desktop")
      .replace(/\.png$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60) || "desktop";
  return `${base}-${stamp}${
    unique ? `-${Math.random().toString(36).slice(2, 7)}` : ""
  }.png`;
}
