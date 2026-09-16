import { describe, expect, it } from "vitest";
import { parseDuckDuckGoResults } from "./webSearch";

const FIXTURE = `
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc">Example &amp; Docs Guide</a>
  </h2>
  <a class="result__snippet" href="...">The <b>official</b> documentation for Example &#38; friends.</a>
</div>
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fother.org%2Fpage">Second Result</a>
  </h2>
  <a class="result__snippet" href="...">Snippet two.</a>
</div>
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fthird.net%2F">Third Result</a>
  </h2>
  <a class="result__snippet" href="...">Snippet three.</a>
</div>
`;

describe("parseDuckDuckGoResults", () => {
  it("extracts titles, real URLs and snippets from DuckDuckGo HTML", () => {
    const results = parseDuckDuckGoResults(FIXTURE);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: "Example & Docs Guide",
      url: "https://example.com/docs",
      snippet: "The official documentation for Example & friends.",
    });
    expect(results[1]).toEqual({ title: "Second Result", url: "https://other.org/page", snippet: "Snippet two." });
    expect(results[2]).toEqual({ title: "Third Result", url: "https://third.net/", snippet: "Snippet three." });
  });

  it("respects the limit", () => {
    expect(parseDuckDuckGoResults(FIXTURE, 2)).toHaveLength(2);
  });

  it("keeps direct (non-redirect) URLs as-is", () => {
    const results = parseDuckDuckGoResults(
      `<a class="result__a" href="https://plain.example/x">Plain Link</a><a class="result__snippet">s</a>`
    );
    expect(results[0]).toMatchObject({ title: "Plain Link", url: "https://plain.example/x" });
  });

  it("returns an empty list when there are no results", () => {
    expect(parseDuckDuckGoResults("<html><body>No results.</body></html>")).toEqual([]);
  });
});
