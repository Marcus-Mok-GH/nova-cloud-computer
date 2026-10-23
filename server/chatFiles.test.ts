import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_ATTACHMENT_TOTAL_CHARS,
  MAX_CHAT_FILE_DATA_URI_CHARS,
} from "@shared/const";
import {
  buildChatUploadContext,
  chatFileAttachmentFileName,
  chatFileStampedFileName,
  readChatFileAttachments,
} from "./chatFiles";

const PDF_URI = "data:application/pdf;base64,JVBERi0xLjQ=";
const TXT_URI = "data:text/plain;base64,aGVsbG8=";
const PNG_URI = "data:image/png;base64,iVBORw0KGgo=";

const pdfFile = (name = "report.pdf") => ({
  name,
  mimeType: "application/pdf",
  dataUri: PDF_URI,
});

describe("readChatFileAttachments", () => {
  it("treats an absent field as no attachments", () => {
    expect(readChatFileAttachments({})).toEqual({ files: [] });
    expect(readChatFileAttachments({ files: null })).toEqual({ files: [] });
  });

  it("rejects a non-array files field", () => {
    const result = readChatFileAttachments({ files: "report.pdf" });
    expect(result.error).toContain("`files` must be an array");
  });

  it("rejects too many files in one message", () => {
    const result = readChatFileAttachments({
      files: [pdfFile(), pdfFile(), pdfFile(), pdfFile()],
    });
    expect(result.error).toContain("at most 3 files");
  });

  it("rejects an entry without a name, mime type, and data URI", () => {
    expect(
      readChatFileAttachments({ files: [{ name: "a.pdf" }] }).error
    ).toContain("name, a mime type");
    expect(
      readChatFileAttachments({ files: ["data:application/pdf;base64,x"] })
        .error
    ).toContain("name, a mime type");
  });

  it("rejects images in the files field - they belong in `images`", () => {
    const result = readChatFileAttachments({
      files: [{ name: "photo.png", mimeType: "image/png", dataUri: PNG_URI }],
    });
    expect(result.error).toContain("`images` field");
  });

  it("rejects active content types that could execute if opened", () => {
    for (const mimeType of ["text/html", "image/svg+xml"]) {
      const result = readChatFileAttachments({
        files: [{ name: "page.html", mimeType, dataUri: `data:${mimeType};base64,PGI+` }],
      });
      expect(result.error).toContain("cannot be attached");
    }
  });

  it("rejects a data URI that does not match the declared mime type", () => {
    const result = readChatFileAttachments({
      files: [{ name: "report.pdf", mimeType: "application/pdf", dataUri: TXT_URI }],
    });
    expect(result.error).toContain("matching its mime type");
  });

  it("rejects a single file over the per-file cap", () => {
    const huge = `data:application/pdf;base64,${"A".repeat(MAX_CHAT_FILE_DATA_URI_CHARS)}`;
    const result = readChatFileAttachments({
      files: [{ name: "big.pdf", mimeType: "application/pdf", dataUri: huge }],
    });
    expect(result.error).toContain("too large");
  });

  it("keeps images and files within one shared size budget", () => {
    // The message's images already occupy (almost) the whole budget, so the
    // file - which fits the per-file cap on its own - cannot ride along.
    const file = {
      name: "clip.pdf",
      mimeType: "application/pdf",
      dataUri: "data:application/pdf;base64,QUJD",
    };
    const imagesChars = MAX_CHAT_ATTACHMENT_TOTAL_CHARS - 10;
    const result = readChatFileAttachments({ files: [file] }, imagesChars);
    expect(result.error).toContain("too large together");
  });

  it("accepts valid files and lowercases their mime types", () => {
    const result = readChatFileAttachments({
      files: [
        pdfFile(),
        { name: "notes.txt", mimeType: "TEXT/PLAIN", dataUri: TXT_URI },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.files).toEqual([
      { name: "report.pdf", mimeType: "application/pdf", dataUri: PDF_URI },
      { name: "notes.txt", mimeType: "text/plain", dataUri: TXT_URI },
    ]);
  });
});

describe("chatFileAttachmentFileName", () => {
  it("keeps the user's own file name so the agent can quote it back", () => {
    expect(chatFileAttachmentFileName(pdfFile(), 0)).toBe("report.pdf");
  });

  it("strips path segments, control characters, and unsafe characters", () => {
    const name = chatFileAttachmentFileName(
      { name: "C:\\\\Users\\\\me/re\u0000port|?.pdf", mimeType: "application/pdf", dataUri: PDF_URI },
      0
    );
    expect(name).toBe("report.pdf");
  });

  it("falls back to a generated name when nothing usable remains", () => {
    const name = chatFileAttachmentFileName(
      { name: "///", mimeType: "application/pdf", dataUri: PDF_URI },
      2,
      Date.parse("2026-10-22T15:30:12Z")
    );
    expect(name).toBe("attachment-20261022153012-3");
  });
});

describe("chatFileStampedFileName", () => {
  it("prefixes the creation stamp so a collision sorts in time order", () => {
    expect(
      chatFileStampedFileName("report.pdf", Date.parse("2026-10-22T15:30:12Z"))
    ).toBe("20261022153012-report.pdf");
  });
});

describe("buildChatUploadContext", () => {
  it("is empty when nothing was attached", () => {
    expect(buildChatUploadContext([], [])).toBe("");
  });

  it("points the agent at visible images", () => {
    const context = buildChatUploadContext(
      [{ name: "image-a.png", id: 11 }],
      []
    );
    expect(context).toContain("an image");
    expect(context).toContain('"image-a.png" (file id 11)');
    expect(context).toContain("you can see it directly");
  });

  it("tells the agent how to open each kind of file", () => {
    const context = buildChatUploadContext(
      [],
      [
        { name: "notes.txt", id: 21, mimeType: "text/plain" },
        { name: "paper.pdf", id: 22, mimeType: "application/pdf" },
        { name: "voice.mp3", id: 23, mimeType: "audio/mpeg" },
      ]
    );
    expect(context).toContain('"notes.txt" (file id 21) - read its contents with read_file');
    expect(context).toContain('"paper.pdf" (file id 22)');
    expect(context).toContain("pypdf");
    expect(context).toContain('"voice.mp3" (file id 23)');
    expect(context).toContain("pydub");
  });

  it("covers a mixed image + file turn and mentions anything that failed to save", () => {
    const context = buildChatUploadContext(
      [{ name: "image-a.png", id: 11 }],
      [{ name: "data.csv", id: 31, mimeType: "text/csv" }],
      1
    );
    expect(context).toContain("an image");
    expect(context).toContain('"data.csv" (file id 31)');
    expect(context).toContain("One attachment could not be saved");
  });
});
