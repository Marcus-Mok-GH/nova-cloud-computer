import type { ChatComposerAttachment, ChatFileUpload } from "@/lib/fileAttachments";

/** What a composer submit (Enter or the send button) should do *right now*. */
export type ComposerSubmitDecision =
  | { kind: "stop" }
  | { kind: "send"; content: string; images: string[]; files: ChatFileUpload[] }
  | { kind: "noop" };

/**
 * Decide a submit before touching any state: "stop" while a run is in flight
 * (the composer button is the Stop affordance), "send" carrying the exact wire
 * payload when there is content to post, "noop" when there is nothing to do.
 * Pure, so it is testable without a DOM.
 */
export function decideComposerSubmit(input: {
  busy: boolean;
  draft: string;
  attachments: ChatComposerAttachment[];
  chatId: string | undefined;
}): ComposerSubmitDecision {
  if (input.busy) return { kind: "stop" };
  if (!input.chatId) return { kind: "noop" };
  const trimmed = input.draft.trim();
  if (!trimmed && !input.attachments.length) return { kind: "noop" };
  const images = input.attachments.flatMap(attachment =>
    attachment.kind === "image" ? [attachment.dataUri] : []
  );
  const files = input.attachments.flatMap(
    (attachment): ChatFileUpload[] =>
      attachment.kind === "file"
        ? [{ name: attachment.name, mimeType: attachment.mimeType, dataUri: attachment.dataUri }]
        : []
  );
  const content =
    trimmed ||
    (input.attachments.length === 1
      ? `Uploaded ${input.attachments[0].name}`
      : `Uploaded ${input.attachments.length} attachments`);
  return { kind: "send", content, images, files };
}
