import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_IMAGE_ATTACHMENTS,
  chatImageAttachmentFileName,
  parseChatImageDataUri,
  readChatImageAttachments,
} from "./chatImages";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const JPEG = "data:image/jpeg;base64,/9j/4AAQ";

describe("readChatImageAttachments", () => {
  it("treats an absent images field as no attachments", () => {
    expect(readChatImageAttachments({ content: "hi" })).toEqual({ images: [] });
    expect(readChatImageAttachments(undefined)).toEqual({ images: [] });
  });

  it("accepts a batch of image data URIs", () => {
    const result = readChatImageAttachments({ images: [PNG, JPEG] });
    expect(result.error).toBeUndefined();
    expect(result.images).toEqual([PNG, JPEG]);
  });

  it("rejects non-image and non-data URIs", () => {
    expect(readChatImageAttachments({ images: ["https://example.com/a.png"] }).error).toBeTruthy();
    expect(readChatImageAttachments({ images: ["data:text/plain;base64,aGk="] }).error).toBeTruthy();
    expect(readChatImageAttachments({ images: ["data:image/svg+xml;base64,PHN2Zz4="] }).error).toBeTruthy();
  });

  it("rejects a non-array images field", () => {
    expect(readChatImageAttachments({ images: PNG }).error).toBeTruthy();
  });

  it("caps the number of attachments", () => {
    const tooMany = Array.from({ length: MAX_CHAT_IMAGE_ATTACHMENTS + 1 }, () => PNG);
    expect(readChatImageAttachments({ images: tooMany }).error).toBeTruthy();
  });

  it("rejects an oversized image", () => {
    const huge = `data:image/png;base64,${"A".repeat(3_000_001)}`;
    expect(readChatImageAttachments({ images: [huge] }).error).toBeTruthy();
  });
});

describe("parseChatImageDataUri", () => {
  it("reads the mime type and extension", () => {
    expect(parseChatImageDataUri(JPEG)).toEqual({
      mimeType: "image/jpeg",
      extension: "jpg",
    });
  });

  it("returns null for unsupported payloads", () => {
    expect(parseChatImageDataUri("not-a-data-uri")).toBeNull();
    expect(parseChatImageDataUri("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
  });
});

describe("chatImageAttachmentFileName", () => {
  it("builds a sortable, named file for the image", () => {
    const named = chatImageAttachmentFileName(PNG, 0, Date.UTC(2026, 9, 2, 15, 30, 12));
    expect(named?.mimeType).toBe("image/png");
    expect(named?.name).toMatch(/^image-20261002153012-1-[a-z0-9]+\.png$/);
  });

  it("returns null when the data URI is not a supported image", () => {
    expect(chatImageAttachmentFileName("data:text/plain;base64,aGk=", 0)).toBeNull();
  });
});
