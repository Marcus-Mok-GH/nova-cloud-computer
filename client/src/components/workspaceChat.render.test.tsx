import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentTray } from "./workspaceChat";
import type { ChatComposerAttachment } from "@/lib/fileAttachments";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/lib/speech", () => ({
  speakMessage: vi.fn(),
  stopAllSpeech: vi.fn(),
  stripMarkdownForSpeech: (text: string) => text,
  TTS_START_EVENT: "tts-start",
  TTS_STOP_EVENT: "tts-stop",
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

const imageAttachment: ChatComposerAttachment = {
  kind: "image",
  id: "img-1",
  name: "corgi.png",
  mimeType: "image/png",
  dataUri: "data:image/png;base64,iVBORw0KGgo=",
};

const fileAttachment = (
  name: string,
  mimeType: string,
  sizeBytes: number
): ChatComposerAttachment => ({
  kind: "file",
  id: `file-${name}`,
  name,
  mimeType,
  dataUri: `data:${mimeType};base64,QUJD`,
  sizeBytes,
});

describe("AttachmentTray", () => {
  it("renders nothing when no attachments are queued", () => {
    expect(renderToStaticMarkup(<AttachmentTray attachments={[]} onRemove={() => {}} />)).toBe("");
  });

  it("renders image thumbnails and file chips side by side", () => {
    const markup = renderToStaticMarkup(
      <AttachmentTray
        attachments={[
          imageAttachment,
          fileAttachment("report.pdf", "application/pdf", 2048),
          fileAttachment("voice.mp3", "audio/mpeg", 3 * 1024 * 1024),
        ]}
        onRemove={() => {}}
      />
    );
    // The image keeps its thumbnail preview.
    expect(markup).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(markup).toContain('alt="corgi.png"');
    // Files render as named chips with a compact size label.
    expect(markup).toContain("report.pdf");
    expect(markup).toContain("2 KB");
    expect(markup).toContain("voice.mp3");
    expect(markup).toContain("3.0 MB");
    // One remove control per attachment.
    expect(markup.match(/aria-label="Remove /g) || []).toHaveLength(3);
  });

  it("gives each file chip an icon matching its content type", () => {
    const markup = renderToStaticMarkup(
      <AttachmentTray
        attachments={[
          fileAttachment("voice.mp3", "audio/mpeg", 1200),
          fileAttachment("notes.txt", "text/plain", 40),
          fileAttachment("data.bin", "application/octet-stream", 40),
        ]}
        onRemove={() => {}}
      />
    );
    expect(markup).toContain("lucide-file-audio");
    expect(markup).toContain("lucide-file-text");
  });
});
