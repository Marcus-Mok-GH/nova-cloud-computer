/**
 * The generate_image agent tool: Nova's built-in image model.
 *
 * A turn that asks for a picture spends one slot of the account's daily image
 * allowance - Free 3, Plus 10, Pro unlimited (see db/imageQuotas). The claim is
 * taken BEFORE the provider call so two concurrent calls cannot both pass the
 * cap, and it is released again when the provider fails, so an outage never
 * consumes a generation the user never received.
 *
 * The image itself is stored as a workspace file (its data URI, exactly like a
 * chat attachment) AND carried back on the tool execution, so the web chat can
 * render the picture inline while the run is live and after a reload.
 */
import {
  claimImageGenerationForUser,
  getImageGenerationStatusForUser,
  releaseImageGenerationClaimForUser,
} from "../db/imageQuotas";
import { createWorkspaceFileForUser } from "../db/workspaceFiles";
import { workspaceRelativePathOf } from "../workspace/paths";
import {
  generatePollinationsImage,
  generatedImageFileName,
  type ImageAspectRatio,
} from "../imageGeneration";
import { type ToolCtx, type ToolExecution } from "./types";

const ASPECT_RATIOS: ReadonlySet<string> = new Set([
  "square",
  "landscape",
  "portrait",
]);

/** The prompt cap the adapter enforces; checked here too for a clean refusal. */
const MAX_PROMPT_LENGTH = 2_000;

function failed(name: string, result: string): ToolExecution {
  return {
    ok: false,
    result,
    action: { kind: "image", name, operation: "failed" },
  };
}

export async function toolGenerateImage(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const prompt = str(args.prompt);
  if (!prompt)
    return failed("generate_image", "A prompt describing the image is required.");
  if (prompt.length > MAX_PROMPT_LENGTH)
    return failed(
      "generate_image",
      `The prompt must be ${MAX_PROMPT_LENGTH} characters or less - describe the image more concisely.`
    );
  const ratioArg = str(args.aspect_ratio);
  const aspectRatio: ImageAspectRatio = ASPECT_RATIOS.has(ratioArg)
    ? (ratioArg as ImageAspectRatio)
    : "square";

  // No server key means no provider to call; check before claiming so a
  // misconfigured deployment does not burn the day's allowance.
  const apiKey = (process.env.POLLINATIONS_API_KEY ?? "").trim();
  if (!apiKey)
    return failed(
      "generate_image",
      "Image generation is not set up on this server yet (POLLINATIONS_API_KEY is missing), so no picture was made. Tell the user an administrator has to configure it."
    );

  const claim = await claimImageGenerationForUser(ownerId);
  if (!claim) {
    const status = await getImageGenerationStatusForUser(ownerId);
    const limit = status.limit ?? 0;
    return {
      ok: false,
      result:
        `You have used all ${limit} of today's image generations - the allowance resets at UTC midnight. ` +
        "Free accounts get 3 a day, Plus gets 10, and Pro is unlimited, so the user can upgrade for more. " +
        "Tell the user plainly how many are left today and when they reset.",
      action: { kind: "image", name: "generate_image", operation: "failed" },
    };
  }

  let image;
  try {
    image = await generatePollinationsImage({ prompt, apiKey, aspectRatio });
  } catch (error) {
    // The generation never happened, so the slot goes back.
    await releaseImageGenerationClaimForUser(ownerId).catch(() => {});
    return failed(
      "generate_image",
      error instanceof Error && error.message.trim()
        ? `The image could not be generated: ${error.message.trim()}`
        : "The image could not be generated. Please try again shortly."
    );
  }

  const name = generatedImageFileName(image.extension, prompt);
  const saved = await createWorkspaceFileForUser(ownerId, {
    name,
    content: image.dataUri,
    mimeType: image.mimeType,
  });
  if (!saved)
    return {
      ok: false,
      result:
        "The image was generated but could not be saved to the workspace - tell the user it is shown in the chat but is not among their files.",
      action: { kind: "image", name, operation: "failed" },
      // The picture still exists; show it rather than losing the generation.
      generatedImage: image.dataUri,
    };

  // Keep a live sandbox in step when this run already woke one; with no
  // machine running the durable store stays authoritative until the next wake
  // syncs it in, exactly like every other durable-only write.
  const relativePath = workspaceRelativePathOf(
    ctx.folderRows,
    saved.name,
    saved.folderId ?? null
  );
  if (relativePath)
    await ctx.mirror({ kind: "write_file", path: relativePath, content: image.dataUri });

  return {
    ok: true,
    result:
      `Generated an image from your prompt and saved it to the workspace as "${saved.name}" (file id ${saved.id}). ` +
      (ctx.channel === "telegram"
        ? "Pictures cannot be delivered over Telegram - tell the user to open the Nova web app or Files to see it."
        : "It is shown in the chat; tell the user they can also open it any time from Files.") +
      " Do not paste its contents back into the conversation.",
    action: { kind: "image", name: saved.name, operation: "created" },
    generatedImage: image.dataUri,
  };
}
