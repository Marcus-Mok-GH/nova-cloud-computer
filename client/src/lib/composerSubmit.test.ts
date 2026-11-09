import { describe, expect, it } from "vitest";
import { decideComposerSubmit } from "./composerSubmit";

describe("decideComposerSubmit", () => {
  it("stops the run when the composer is busy, even with a draft", () => {
    expect(
      decideComposerSubmit({ busy: true, draft: "hi", attachments: [], chatId: "c1" })
    ).toEqual({ kind: "stop" });
  });

  it("no-ops when there is no chat, or nothing to post", () => {
    expect(decideComposerSubmit({ busy: false, draft: "hi", attachments: [], chatId: undefined }))
      .toEqual({ kind: "noop" });
    expect(decideComposerSubmit({ busy: false, draft: "   ", attachments: [], chatId: "c1" }))
      .toEqual({ kind: "noop" });
  });

  it("sends plain text with the trimmed content and no attachments", () => {
    expect(
      decideComposerSubmit({ busy: false, draft: "  hello  ", attachments: [], chatId: "c1" })
    ).toEqual({ kind: "send", content: "hello", images: [], files: [] });
  });

  it("posts a single image attachment as its own caption and payload", () => {
    const img = {
      kind: "image" as const,
      id: "a",
      name: "corgi.png",
      mimeType: "image/png",
      dataUri: "data:image/png;base64,x",
    };
    expect(decideComposerSubmit({ busy: false, draft: "", attachments: [img], chatId: "c1" })).toEqual({
      kind: "send",
      content: "Uploaded corgi.png",
      images: ["data:image/png;base64,x"],
      files: [],
    });
  });

  it("posts a single file attachment as its own caption and payload", () => {
    const f = {
      kind: "file" as const,
      id: "b",
      name: "notes.txt",
      mimeType: "text/plain",
      dataUri: "data:text/plain;base64,x",
      sizeBytes: 10,
    };
    expect(decideComposerSubmit({ busy: false, draft: "", attachments: [f], chatId: "c1" })).toEqual({
      kind: "send",
      content: "Uploaded notes.txt",
      images: [],
      files: [{ name: "notes.txt", mimeType: "text/plain", dataUri: "data:text/plain;base64,x" }],
    });
  });

  it("posts multiple attachments with a count caption and mixed payloads", () => {
    const img = {
      kind: "image" as const,
      id: "a",
      name: "a.png",
      mimeType: "image/png",
      dataUri: "data:image/png;base64,i",
    };
    const file = {
      kind: "file" as const,
      id: "b",
      name: "b.txt",
      mimeType: "text/plain",
      dataUri: "data:text/plain;base64,f",
      sizeBytes: 10,
    };
    expect(
      decideComposerSubmit({ busy: false, draft: "look", attachments: [img, file], chatId: "c1" })
    ).toEqual({
      kind: "send",
      content: "look",
      images: ["data:image/png;base64,i"],
      files: [{ name: "b.txt", mimeType: "text/plain", dataUri: "data:text/plain;base64,f" }],
    });
  });
});
