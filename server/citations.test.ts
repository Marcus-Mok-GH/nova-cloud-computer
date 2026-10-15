import { describe, expect, it } from "vitest";
import {
  RunCitations,
  browseOpenUrl,
  citationStyleFor,
} from "./citations";

const researchArgs = JSON.stringify({ topic: "What is Nova?" });
const browseArgs = (command: string) => JSON.stringify({ command });

describe("browseOpenUrl", () => {
  it("reads the URL an open command navigated to", () => {
    expect(browseOpenUrl("open https://example.com/docs")).toBe(
      "https://example.com/docs"
    );
    expect(browseOpenUrl('open "https://example.com/a b"')).toBe(
      "https://example.com/a"
    );
  });

  it("promotes a scheme-less host to https", () => {
    expect(browseOpenUrl("open example.com/pricing")).toBe(
      "https://example.com/pricing"
    );
    expect(browseOpenUrl('open "example.com"')).toBe("https://example.com");
  });

  it("ignores commands that do not open a web page", () => {
    expect(browseOpenUrl("screenshot")).toBeUndefined();
    expect(browseOpenUrl("click 420 260")).toBeUndefined();
    expect(browseOpenUrl("type \"hello\"")).toBeUndefined();
    expect(browseOpenUrl("open index.html")).toBeUndefined();
    expect(browseOpenUrl("open /workspace/notes.md")).toBeUndefined();
    expect(browseOpenUrl("")).toBeUndefined();
  });
});

describe("RunCitations", () => {
  it("lists a research report's sources as clickable Markdown at the bottom", () => {
    const citations = new RunCitations();
    citations.record(
      "research_web",
      researchArgs,
      {
        ok: true,
        citations: [
          { url: "https://nova.example/docs", title: "Nova docs" },
          { url: "https://exa.ai/blog", title: "Exa blog" },
        ],
      }
    );

    expect(citations.block("Here is what I found.", "markdown")).toBe(
      "\n\n---\n\n**Sources**\n\n" +
        "1. [Nova docs](https://nova.example/docs)\n" +
        "2. [Exa blog](https://exa.ai/blog)"
    );
  });

  it("renders plain text for Telegram, which sends Markdown literally", () => {
    const citations = new RunCitations();
    citations.record("research_web", researchArgs, {
      ok: true,
      citations: [{ url: "https://nova.example/docs", title: "Nova docs" }],
    });

    expect(citations.block("Here is what I found.", "plain")).toBe(
      "\n\nSources:\n1. Nova docs - https://nova.example/docs"
    );
  });

  it("cites the page a browse call opened, labelled with its host", () => {
    const citations = new RunCitations();
    citations.record("browse", browseArgs("open https://example.com/docs"), {
      ok: true,
      result: "Page text",
    });

    expect(citations.block("The docs say so.", "markdown")).toBe(
      "\n\n---\n\n**Sources**\n\n1. [example.com](https://example.com/docs)"
    );
  });

  it("deduplicates a source consulted more than once, in first-sight order", () => {
    const citations = new RunCitations();
    citations.record("research_web", researchArgs, {
      ok: true,
      citations: [
        { url: "https://a.example", title: "A" },
        { url: "https://b.example", title: "B" },
      ],
    });
    citations.record("research_web", researchArgs, {
      ok: true,
      citations: [{ url: "https://a.example", title: "A again" }],
    });
    citations.record("browse", browseArgs("open https://a.example"), {
      ok: true,
      result: "Page text",
    });

    expect(citations.size).toBe(2);
    expect(citations.block("Answer.", "markdown")).toContain(
      "1. [A](https://a.example)"
    );
    expect(citations.block("Answer.", "markdown")).toContain(
      "2. [B](https://b.example)"
    );
  });

  it("collects nothing from a call that failed", () => {
    const citations = new RunCitations();
    citations.record("research_web", researchArgs, {
      ok: false,
      citations: [{ url: "https://a.example", title: "A" }],
    });
    citations.record("browse", browseArgs("open https://b.example"), {
      ok: false,
      result: "Web research failed.",
    });

    expect(citations.size).toBe(0);
    expect(citations.block("Answer.", "markdown")).toBe("");
  });

  it("ignores tools that carry no web source", () => {
    const citations = new RunCitations();
    citations.record(
      "thinker",
      JSON.stringify({ question: "why?" }),
      { ok: true, result: "An analysis." }
    );

    expect(citations.size).toBe(0);
    expect(citations.block("Answer.", "markdown")).toBe("");
  });

  it("skips sources the reply already links, so a citation is never repeated", () => {
    const citations = new RunCitations();
    citations.record("research_web", researchArgs, {
      ok: true,
      citations: [
        { url: "https://a.example", title: "A" },
        { url: "https://b.example", title: "B" },
      ],
    });

    const block = citations.block(
      "Straight from https://a.example itself.",
      "markdown"
    );
    expect(block).toBe(
      "\n\n---\n\n**Sources**\n\n1. [B](https://b.example)"
    );
    expect(block).not.toContain("https://a.example");
  });

  it("returns no block at all once every source is already linked", () => {
    const citations = new RunCitations();
    citations.record("research_web", researchArgs, {
      ok: true,
      citations: [{ url: "https://a.example", title: "A" }],
    });

    expect(citations.block("See https://a.example.", "markdown")).toBe("");
  });

  it("survives a malformed citation instead of breaking the reply", () => {
    const citations = new RunCitations();
    citations.record("research_web", researchArgs, {
      ok: true,
      citations: [
        { url: "  https://a.example/x ", title: " A [beta] " },
        { url: "", title: "No url" },
      ],
    });

    expect(citations.block("Answer.", "markdown")).toBe(
      "\n\n---\n\n**Sources**\n\n1. [A beta](https://a.example/x)"
    );
  });

  it("caps an overlong title so one page cannot bury the list", () => {
    const citations = new RunCitations();
    citations.record("research_web", researchArgs, {
      ok: true,
      citations: [{ url: "https://a.example", title: "x".repeat(400) }],
    });

    const block = citations.block("Answer.", "markdown");
    expect(block.length).toBeLessThan(200);
    expect(block).toContain("…");
  });

  it("falls back to a bare URL when a source has no title", () => {
    const citations = new RunCitations();
    citations.record("research_web", researchArgs, {
      ok: true,
      citations: [{ url: "https://a.example/page", title: "" }],
    });

    expect(citations.block("Answer.", "markdown")).toBe(
      "\n\n---\n\n**Sources**\n\n1. https://a.example/page"
    );
    expect(citations.block("Answer.", "plain")).toBe(
      "\n\nSources:\n1. https://a.example/page"
    );
  });

  it("treats a failed browse call's unparseable arguments as no citation", () => {
    const citations = new RunCitations();
    citations.record("browse", "not json", { ok: true, result: "text" });

    expect(citations.size).toBe(0);
  });
});

describe("citationStyleFor", () => {
  it("keeps Markdown for the web chat and plain text for Telegram", () => {
    expect(citationStyleFor("web")).toBe("markdown");
    expect(citationStyleFor(undefined)).toBe("markdown");
    expect(citationStyleFor("telegram")).toBe("plain");
  });
});
