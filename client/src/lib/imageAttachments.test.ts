import { describe, expect, it } from "vitest";
import {
  collectChatImageAttachments,
  isSupportedChatImage,
  prepareChatImageAttachment,
} from "./imageAttachments";

const file = (name: string, type: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type });

describe("isSupportedChatImage", () => {
  it("accepts the image types the composer advertises", () => {
    expect(isSupportedChatImage(file("a.png", "image/png"))).toBe(true);
    expect(isSupportedChatImage(file("a.jpg", "image/jpeg"))).toBe(true);
    expect(isSupportedChatImage(file("a.webp", "image/webp"))).toBe(true);
    expect(isSupportedChatImage(file("a.gif", "image/gif"))).toBe(true);
  });

  it("rejects unsupported types", () => {
    expect(isSupportedChatImage(file("a.svg", "image/svg+xml"))).toBe(false);
    expect(isSupportedChatImage(file("a.pdf", "application/pdf"))).toBe(false);
  });
});

describe("prepareChatImageAttachment", () => {
  it("explains why an unsupported file cannot be attached", async () => {
    const result = await prepareChatImageAttachment(
      file("notes.pdf", "application/pdf")
    );
    expect("error" in result && result.error).toContain("notes.pdf");
  });
});

describe("collectChatImageAttachments", () => {
  it("returns nothing for a set with no images", async () => {
    const result = await collectChatImageAttachments([
      file("notes.pdf", "application/pdf"),
    ]);
    expect(result.attachments).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});
