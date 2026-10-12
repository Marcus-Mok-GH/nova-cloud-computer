import { describe, expect, it } from "vitest";
import { chunkSpokenText, stripMarkdownForSpeech } from "./speech";

describe("stripMarkdownForSpeech", () => {
  it("replaces fenced code blocks with a placeholder", () => {
    const out = stripMarkdownForSpeech(
      "Here is code:\n```ts\nconst x = 1;\n```\nDone."
    );
    expect(out).not.toContain("const x");
    expect(out).toContain("code sample");
    expect(out).toContain("Done.");
  });

  it("replaces an unclosed fence with a placeholder", () => {
    const out = stripMarkdownForSpeech("Hello:\n```ts\nconst x = 1;");
    expect(out).not.toContain("```");
    expect(out).not.toContain("const x");
    expect(out).toContain("code sample");
  });

  it("keeps link labels and drops URLs", () => {
    const out = stripMarkdownForSpeech(
      "See [docs](https://example.com/x) or https://example.com/y now"
    );
    expect(out).toContain("docs");
    expect(out).not.toContain("https://");
  });

  it("strips headings, quotes, lists, and emphasis", () => {
    const out = stripMarkdownForSpeech(
      "# Title\n> quoted\n- item one\n1. item two\n**bold** and *italic*"
    );
    expect(out).toContain("Title");
    expect(out).toContain("bold");
    expect(out).toContain("italic");
    expect(out).not.toContain("#");
    expect(out).not.toContain("**");
  });

  it("returns an empty string for empty input", () => {
    expect(stripMarkdownForSpeech("")).toBe("");
  });
});

describe("chunkSpokenText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkSpokenText("Hello there.")).toEqual(["Hello there."]);
  });

  it("returns no chunks for blank text", () => {
    expect(chunkSpokenText("   ")).toEqual([]);
  });

  it("splits long text into bounded chunks without losing words", () => {
    const text = Array.from(
      { length: 20 },
      (_, i) => `Sentence number ${i} states a complete fact.`
    ).join(" ");
    const chunks = chunkSpokenText(text, 220);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(220);
    expect(chunks.join(" ")).toBe(text.replace(/\s+/g, " "));
  });
});
