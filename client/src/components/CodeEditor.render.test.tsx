import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import CodeEditor from "./CodeEditor";

const renderEditor = (value: string) => renderToStaticMarkup(
  <CodeEditor value={value} language="typescript" onChange={() => {}} ariaLabel="Edit demo.ts" />
);

describe("CodeEditor", () => {
  it("renders a line-number gutter for every line", () => {
    const markup = renderEditor("const a = foo;\nlet b = bar;\nreturn a + b;");
    expect(markup).toContain(">1<");
    expect(markup).toContain(">2<");
    expect(markup).toContain(">3<");
  });

  it("syntax highlights the code while remaining directly editable", () => {
    const markup = renderEditor("const a = foo;");
    // Keyword token styling proves the highlight overlay is active.
    expect(markup).toContain("text-purple-700");
    // The textarea stays on top so typing works without an explicit edit mode.
    expect(markup).toContain('aria-label="Edit demo.ts"');
    expect(markup).toContain('wrap="off"');
    expect(markup).toContain('spellCheck="false"');
  });
});
