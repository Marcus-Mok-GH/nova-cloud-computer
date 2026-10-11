import { describe, expect, it } from "vitest";
import {
  buildFileSearchMatcher,
  FILE_SEARCH_DEFAULT_LIMIT,
  FILE_SEARCH_MAX_MATCHES_PER_FILE,
  FILE_SEARCH_MAX_QUERY_LENGTH,
  searchWorkspaceFiles,
  type SearchableWorkspaceFile,
} from "./fileSearch";

const file = (overrides: Partial<SearchableWorkspaceFile> = {}): SearchableWorkspaceFile => ({
  id: 1,
  name: "notes.md",
  content: "",
  mimeType: "text/plain",
  folderId: null,
  ...overrides,
});

describe("buildFileSearchMatcher", () => {
  it("rejects a blank query", () => {
    expect(buildFileSearchMatcher("   ")).toEqual({ error: "Enter something to search for." });
  });

  it("rejects a query over the length cap", () => {
    expect(buildFileSearchMatcher("a".repeat(FILE_SEARCH_MAX_QUERY_LENGTH + 1))).toEqual({
      error: `Search queries are at most ${FILE_SEARCH_MAX_QUERY_LENGTH} characters.`,
    });
  });

  it("rejects an invalid regular expression", () => {
    expect(buildFileSearchMatcher("(unclosed", true)).toEqual({ error: "That is not a valid regular expression." });
  });

  it("rejects a pattern that matches everything", () => {
    expect(buildFileSearchMatcher("a*", true)).toEqual({ error: "That pattern matches everything - make it more specific." });
  });

  it("treats a literal query as plain text, not a pattern", () => {
    const matcher = buildFileSearchMatcher("a.b");
    expect("error" in matcher).toBe(false);
    if ("error" in matcher) return;
    expect(matcher.test("xxa.bxx")).toBe(true);
    expect(matcher.test("xxaxbxx")).toBe(false);
  });

  it("matches case-insensitively and locates the first match", () => {
    const matcher = buildFileSearchMatcher("nova");
    expect("error" in matcher).toBe(false);
    if ("error" in matcher) return;
    expect(matcher.test("Nova Cloud")).toBe(true);
    expect(matcher.test("nothing here")).toBe(false);
    expect(matcher.firstIndex("hi NOVA there")).toBe(3);
  });
});

describe("searchWorkspaceFiles", () => {
  it("returns nothing when no file matches", () => {
    expect(searchWorkspaceFiles([file({ content: "hello" })], { query: "goodbye" })).toEqual({ matches: [] });
  });

  it("finds files by name and body, ranking name matches first", () => {
    const result = searchWorkspaceFiles(
      [
        file({ id: 1, name: "notes.md", content: "the launch is on Friday" }),
        file({ id: 2, name: "launch-plan.md", content: "draft" }),
        file({ id: 3, name: "shopping.txt", content: "milk and eggs" }),
      ],
      { query: "launch" },
    );
    expect("matches" in result).toBe(true);
    if (!("matches" in result)) return;
    expect(result.matches.map(match => match.name)).toEqual(["launch-plan.md", "notes.md"]);
    expect(result.matches[0]).toMatchObject({ matchedName: true, matchCount: 0, score: 1000 });
  });

  it("summarizes body matches with 1-based line snippets", () => {
    const result = searchWorkspaceFiles(
      [file({ id: 7, name: "brief.md", folderId: 3, content: "Intro line\nShip the launch on Friday\nClosing" })],
      { query: "launch" },
    );
    if (!("matches" in result)) throw new Error("expected matches");
    expect(result.matches[0]).toMatchObject({
      id: 7,
      folderId: 3,
      matchedName: false,
      matchCount: 1,
      snippets: [{ line: 2, text: "Ship the launch on Friday" }],
    });
  });

  it("caps the snippets (and the reported count) per file", () => {
    const content = Array.from({ length: 6 }, (_, index) => `match number ${index}`).join("\n");
    const result = searchWorkspaceFiles([file({ content })], { query: "match" });
    if (!("matches" in result)) throw new Error("expected matches");
    expect(result.matches[0].matchCount).toBe(FILE_SEARCH_MAX_MATCHES_PER_FILE);
    expect(result.matches[0].snippets).toHaveLength(FILE_SEARCH_MAX_MATCHES_PER_FILE);
    expect(result.matches[0].snippets[0]).toEqual({ line: 1, text: "match number 0" });
  });

  it("supports regular expression queries", () => {
    const result = searchWorkspaceFiles(
      [file({ id: 1, name: "log.txt", content: "error code 500\nok" }), file({ id: 2, name: "other.txt", content: "fine" })],
      { query: "code \\d+", regex: true },
    );
    if (!("matches" in result)) throw new Error("expected matches");
    expect(result.matches.map(match => match.id)).toEqual([1]);
  });

  it("surfaces the matcher error for a bad pattern", () => {
    expect(searchWorkspaceFiles([file()], { query: "(", regex: true })).toEqual({ error: "That is not a valid regular expression." });
  });

  it("does not scan inside binary data-URI content but still matches the name", () => {
    const binary = file({ id: 1, name: "photo.png", content: "data:image/png;base64,AAAAcGhvdG8=" });
    expect(searchWorkspaceFiles([binary], { query: "photo" })).toMatchObject({ matches: [{ matchedName: true, matchCount: 0 }] });
    expect(searchWorkspaceFiles([binary], { query: "AAAA" })).toEqual({ matches: [] });
  });

  it("honors an explicit result limit and defaults to the standard cap", () => {
    const many = Array.from({ length: 5 }, (_, index) => file({ id: index + 1, name: `match-${index}.md` }));
    const limited = searchWorkspaceFiles(many, { query: "match", limit: 2 });
    if (!("matches" in limited)) throw new Error("expected matches");
    expect(limited.matches).toHaveLength(2);

    const flood = Array.from({ length: FILE_SEARCH_DEFAULT_LIMIT + 10 }, (_, index) => file({ id: index + 1, name: `match-${index}.md` }));
    const capped = searchWorkspaceFiles(flood, { query: "match" });
    if (!("matches" in capped)) throw new Error("expected matches");
    expect(capped.matches).toHaveLength(FILE_SEARCH_DEFAULT_LIMIT);
  });

  it("keeps the match in view when a line is longer than the snippet cap", () => {
    const content = `${"x".repeat(400)}needle${"y".repeat(400)}`;
    const result = searchWorkspaceFiles([file({ content })], { query: "needle" });
    if (!("matches" in result)) throw new Error("expected matches");
    const snippet = result.matches[0].snippets[0].text;
    expect(snippet).toContain("needle");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });
});
