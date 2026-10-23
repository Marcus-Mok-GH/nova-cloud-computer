import { describe, expect, it } from "vitest";
import {
  collectChatFileAttachments,
  dragCarriesFiles,
  isDesktopDragDrop,
  prepareChatFileAttachment,
  queueComposerAttachments,
  type ChatComposerAttachment,
} from "./fileAttachments";
import {
  MAX_CHAT_ATTACHMENT_TOTAL_CHARS,
  MAX_CHAT_FILE_ATTACHMENTS,
  MAX_CHAT_FILE_DATA_URI_CHARS,
} from "@shared/const";

const file = (name: string, type: string, bytes = 4) =>
  new File([new Uint8Array(bytes).fill(65)], name, { type });

const imageAttachment = (dataUri = "data:image/png;base64,QQ=="): ChatComposerAttachment => ({
  kind: "image",
  id: `img-${dataUri.length}-${Math.random()}`,
  name: "a.png",
  mimeType: "image/png",
  dataUri,
});

const fileAttachment = (dataUri = "data:text/plain;base64,QQ=="): ChatComposerAttachment => ({
  kind: "file",
  id: `file-${dataUri.length}-${Math.random()}`,
  name: "notes.txt",
  mimeType: "text/plain",
  dataUri,
  sizeBytes: 2,
});

describe("prepareChatFileAttachment", () => {
  it("encodes an accepted file as a data URI attachment", async () => {
    const result = await prepareChatFileAttachment(file("notes.txt", "text/plain"));
    expect("attachment" in result && result.attachment).toMatchObject({
      kind: "file",
      name: "notes.txt",
      mimeType: "text/plain",
      dataUri: "data:text/plain;base64,QUFBQQ==",
      sizeBytes: 4,
    });
  });

  it("explains why an image cannot ride in the files lane", async () => {
    const result = await prepareChatFileAttachment(file("photo.png", "image/png"));
    expect("error" in result && result.error).toContain("photo.png");
  });

  it("explains why active content cannot be attached", async () => {
    const result = await prepareChatFileAttachment(file("page.html", "text/html"));
    expect("error" in result && result.error).toContain("cannot be attached");
  });

  it("rejects a file over the per-file cap before reading it", async () => {
    const big = file("big.bin", "application/pdf", MAX_CHAT_FILE_DATA_URI_CHARS);
    const result = await prepareChatFileAttachment(big);
    expect("error" in result && result.error).toContain("too large");
  });
});

describe("collectChatFileAttachments", () => {
  it("keeps accepted files and surfaces why another could not attach", async () => {
    const result = await collectChatFileAttachments([
      file("b.html", "text/html"),
      file("c.txt", "text/plain"),
    ]);
    expect(result.attachments.map(attachment => attachment.name)).toEqual([
      "c.txt",
    ]);
    expect(result.error).toContain("cannot be attached");
  });

  it("returns nothing for an empty batch", async () => {
    const result = await collectChatFileAttachments([]);
    expect(result.attachments).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

describe("queueComposerAttachments", () => {
  it("appends what fits and counts the overflow", () => {
    const { accepted, overflow } = queueComposerAttachments(
      [],
      [fileAttachment("data:text/plain;base64,QQ=="), fileAttachment("data:text/plain;base64,Qg==")]
    );
    expect(accepted).toHaveLength(2);
    expect(overflow).toBe(0);
  });

  it("caps images and files at their per-message counts", () => {
    const current = [
      imageAttachment(),
      imageAttachment("data:image/png;base64,QQo="),
      imageAttachment("data:image/png;base64,QQpC"),
      imageAttachment("data:image/png;base64,QkpCQQ=="),
    ];
    const { accepted, overflow } = queueComposerAttachments(current, [
      imageAttachment("data:image/png;base64,Q2Nj"),
      fileAttachment("data:text/plain;base64,QQ=="),
      fileAttachment("data:text/plain;base64,Qg=="),
      fileAttachment("data:text/plain;base64,Qw=="),
      fileAttachment("data:text/plain;base64,Q0Q="),
    ]);
    // The fifth image is dropped; the four file slots (3 max) take three.
    expect(accepted.filter(a => a.kind === "image")).toHaveLength(0);
    expect(accepted.filter(a => a.kind === "file")).toHaveLength(3);
    expect(overflow).toBe(2);
  });

  it("caps files at three per message even when no images are queued", () => {
    // Regression: the combined image+file ceiling alone let a drop of seven
    // files queue all seven, which the server then rejected outright.
    const { accepted, overflow } = queueComposerAttachments(
      [],
      Array.from({ length: 7 }, (_, index) =>
        fileAttachment(`data:text/plain;base64,Q${index}==`)
      )
    );
    expect(accepted).toHaveLength(MAX_CHAT_FILE_ATTACHMENTS);
    expect(accepted.every(attachment => attachment.kind === "file")).toBe(true);
    expect(overflow).toBe(7 - MAX_CHAT_FILE_ATTACHMENTS);
  });

  it("counts files already queued against the file cap, not the image slots", () => {
    const current = [
      fileAttachment("data:text/plain;base64,QQ=="),
      fileAttachment("data:text/plain;base64,Qg=="),
      fileAttachment("data:text/plain;base64,Qw=="),
    ];
    const { accepted, overflow } = queueComposerAttachments(current, [
      fileAttachment("data:text/plain;base64,Q0Q="),
      imageAttachment("data:image/png;base64,Q2Nj"),
    ]);
    // Three files are already queued, so only the image still fits.
    expect(accepted.map(attachment => attachment.kind)).toEqual(["image"]);
    expect(overflow).toBe(1);
  });

  it("enforces the shared size budget across images and files", () => {
    // A file that fits the budget on its own but leaves no room for anything
    // else once queued (prepared straight into the list, bypassing the
    // smaller per-file cap that the composer enforces while encoding).
    const bigFile = `data:application/pdf;base64,${"A".repeat(
      MAX_CHAT_ATTACHMENT_TOTAL_CHARS - 10 - "data:application/pdf;base64,".length
    )}`;
    const prepared: ChatComposerAttachment[] = [
      {
        kind: "file",
        id: "big",
        name: "big.pdf",
        mimeType: "application/pdf",
        dataUri: bigFile,
        sizeBytes: bigFile.length,
      },
      fileAttachment("data:text/plain;base64,QQ=="),
    ];
    // The per-file cap lets big.pdf through preparation, but the shared
    // budget leaves no room for it once anything else is queued.
    const first = queueComposerAttachments([], [prepared[0]]);
    expect(first.accepted).toHaveLength(1);
    const second = queueComposerAttachments(first.accepted, [prepared[1]]);
    expect(second.accepted).toHaveLength(0);
    expect(second.overflow).toBe(1);
  });
});

describe("dragCarriesFiles", () => {
  it("detects file drags and ignores text or selection drags", () => {
    expect(dragCarriesFiles(["Files"])).toBe(true);
    expect(dragCarriesFiles(["text/plain"])).toBe(false);
    expect(dragCarriesFiles(undefined)).toBe(false);
    expect(dragCarriesFiles(null)).toBe(false);
  });
});

describe("isDesktopDragDrop", () => {
  it("is true only for a fine-pointer hover device", () => {
    const desktop = {
      matchMedia: () => ({ matches: true }),
    } as unknown as Pick<Window, "matchMedia">;
    const touch = {
      matchMedia: () => ({ matches: false }),
    } as unknown as Pick<Window, "matchMedia">;
    expect(isDesktopDragDrop(desktop)).toBe(true);
    expect(isDesktopDragDrop(touch)).toBe(false);
  });

  it("is false without a browser window (SSR and tests)", () => {
    expect(isDesktopDragDrop()).toBe(false);
  });
});
