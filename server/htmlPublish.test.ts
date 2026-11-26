import { describe, expect, it } from "vitest";
import { NOVA_PUBLIC_APP_URL } from "@shared/const";
import { preparePublishedHtml, repairBabelRuntime } from "./htmlPublish";

/** The shape of a generated page that broke: the react preset plus unpinned Babel. */
const BROKEN_PAGE = `<!doctype html>
<html><head>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head><body><div id="root"></div>
<script type="text/babel" data-presets="react" src="src/App.jsx"></script>
</body></html>`;

describe("repairBabelRuntime", () => {
  it("pins Babel to v7 when the react preset would break the page", () => {
    const repaired = repairBabelRuntime(BROKEN_PAGE);
    expect(repaired).toContain("https://unpkg.com/@babel/standalone@7/babel.min.js");
    expect(repaired).not.toContain("https://unpkg.com/@babel/standalone/babel.min.js");
  });

  it("leaves a page without the react preset alone", () => {
    const page = BROKEN_PAGE.replace('data-presets="react"', "");
    expect(repairBabelRuntime(page)).toBe(page);
  });

  it("leaves an already pinned page alone", () => {
    const page = BROKEN_PAGE.replace(
      "https://unpkg.com/@babel/standalone/babel.min.js",
      "https://unpkg.com/@babel/standalone@7/babel.min.js",
    );
    expect(repairBabelRuntime(page)).toBe(page);
  });

  it("leaves pages with no Babel at all alone", () => {
    const page = "<!doctype html><html><body><h1>Hi</h1></body></html>";
    expect(repairBabelRuntime(page)).toBe(page);
  });
});

describe("preparePublishedHtml", () => {
  it("adds the badge and pins the Babel runtime in one pass", () => {
    const published = preparePublishedHtml(BROKEN_PAGE);
    expect(published).toContain("data-nova-badge");
    expect(published).toContain(`href="${NOVA_PUBLIC_APP_URL}"`);
    expect(published).toContain("https://unpkg.com/@babel/standalone@7/babel.min.js");
  });

  it("is idempotent", () => {
    const once = preparePublishedHtml(BROKEN_PAGE);
    expect(preparePublishedHtml(once)).toBe(once);
  });
});
