import { describe, expect, it } from "vitest";
import { highlightSegments } from "./fileSearch";

describe("highlightSegments", () => {
  it("marks the literal match case-insensitively", () => {
    expect(highlightSegments("Ship the Launch on Friday", "launch")).toEqual([
      { text: "Ship the ", match: false },
      { text: "Launch", match: true },
      { text: " on Friday", match: false },
    ]);
  });

  it("treats the query as plain text by default", () => {
    expect(highlightSegments("axb", "a.b")).toEqual([{ text: "axb", match: false }]);
  });

  it("supports a regular expression query", () => {
    expect(highlightSegments("error 500", "\\d+", true)).toEqual([
      { text: "error ", match: false },
      { text: "500", match: true },
    ]);
  });

  it("returns the whole text when there is no match or the pattern is invalid", () => {
    expect(highlightSegments("plain", "zzz")).toEqual([{ text: "plain", match: false }]);
    expect(highlightSegments("plain", "(", true)).toEqual([{ text: "plain", match: false }]);
    expect(highlightSegments("plain", "   ")).toEqual([{ text: "plain", match: false }]);
  });

  it("does not loop on a zero-width match", () => {
    expect(highlightSegments("abc", "\\b", true).map(segment => segment.text).join("")).toBe("abc");
  });
});
