/**
 * Small helpers shared by the browser's two attachment lanes (images and
 * other files): one id scheme for queued attachments, and one way to settle a
 * batch of preparation results, so the composer handles both alike.
 */

/** Lifetime-unique id for one queued composer attachment. */
export function newAttachmentId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Splits prepared attachment results into what succeeded and the first
 * failure's message. An empty batch yields no attachments and no error.
 */
export function collectPreparedAttachments<T>(
  results: ReadonlyArray<{ attachment: T } | { error: string }>
): { attachments: T[]; error?: string } {
  const attachments: T[] = [];
  let error: string | undefined;
  for (const result of results) {
    if ("attachment" in result) attachments.push(result.attachment);
    else error ??= result.error;
  }
  return error === undefined ? { attachments } : { attachments, error };
}
