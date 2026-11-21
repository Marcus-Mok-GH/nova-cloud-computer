import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./markdown";

const render = (text: string) => renderToStaticMarkup(React.createElement(MarkdownText, { text }));

describe("MarkdownText", () => {
  it("renders plain text unchanged", () => {
    expect(render("Just a normal sentence.")).toContain("Just a normal sentence.");
  });

  it("renders bold and italics", () => {
    const html = render("This is **bold** and *italic* and __strong__ and ~~struck~~.");
    expect(html).toContain('class="font-bold">bold</strong>');
    expect(html).toContain(">italic</em>");
    expect(html).toContain(">strong</strong>");
    expect(html).toContain(">struck</s>");
  });

  it("renders inline code without formatting inside it", () => {
    const html = render("Run `const x = **not bold**;` now.");
    expect(html).toContain('**not bold**;</code>');
    expect(html).toContain('<code class=');
  });

  it("leaves prose asterisks and snake_case alone", () => {
    expect(render("2 * 3 * 4 = 24")).toContain("2 * 3 * 4 = 24");
    expect(render("use my_var_name here")).toContain("my_var_name");
  });

  it("renders bullet and numbered lists", () => {
    const html = render("- first\n- second\n\n1. step one\n2. step two");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("<li>step one</li>");
    expect(html).toContain("<li>step two</li>");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
  });

  it("renders headings and blockquotes", () => {
    const html = render("## My heading\n\n> quoted wisdom");
    expect(html).toContain("My heading");
    expect(html).toContain("<blockquote");
    expect(html).toContain("quoted wisdom");
  });

  it("renders links but only with safe protocols", () => {
    const html = render("See [Nova](https://example.com) and https://plain.example.org plus [bad](javascript:alert(1))");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('<a href="https://plain.example.org"');
    // unsafe link renders as inert text, never as an href
    expect(html).not.toContain('<a href="javascript:');
    expect(html).toContain("[bad](javascript:alert(1))");
  });

  it("renders fenced code blocks with syntax highlighting markup", () => {
    const html = render("Intro\n\n```ts\nconst x: number = 1;\n```\n\nOutro");
    expect(html).toContain("x:</span>");
    expect(html).toContain("font-mono");
    // syntax-highlighted spans from the existing highlighter
    expect(html).toContain("text-purple-700");
  });

  it("keeps rendering an unclosed code fence (streaming)", () => {
    const html = render("```js\nconsole.log(1);");
    expect(html).toContain("console</span>");
    expect(html).toContain("font-mono");
  });

  it("preserves single newlines as line breaks inside a paragraph", () => {
    const html = render("line one\nline two");
    expect(html).toContain("<br/>");
  });

  it("renders a GFM table with a header row and body cells", () => {
    const html = render("| Plan | Price |\n| --- | --- |\n| Free | $0 |\n| Pro | $10 |");
    expect(html).toContain("<table");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain(">Plan</th>");
    expect(html).toContain(">Pro</td>");
    expect(html).toContain("$10");
  });

  it("applies delimiter alignment to header and body cells", () => {
    const html = render("| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |");
    expect(html).toContain("text-start");
    expect(html).toContain("text-center");
    expect(html).toContain("text-end");
  });

  it("keeps escaped pipes inside a cell", () => {
    const html = render("| Command |\n| --- |\n| echo \\| pipe |");
    expect(html).toContain("echo | pipe");
    expect(html).not.toContain("echo \\");
  });

  it("renders a table without leading or trailing pipes", () => {
    const html = render("Name | Note\n--- | ---\nNova | works");
    expect(html).toContain("<table");
    expect(html).toContain(">Nova</td>");
  });

  it("leaves pipe-heavy prose alone when the delimiter row is missing", () => {
    const html = render("a | b\njust another line");
    expect(html).not.toContain("<table");
    expect(html).toContain("a | b");
  });

  it("does not treat a mismatched delimiter row as a table", () => {
    const html = render("| A | B |\n| --- |\n| value |");
    expect(html).not.toContain("<table");
    expect(html).toContain("| A | B |");
  });

  it("keeps rendering a table while it streams (header + delimiter only)", () => {
    const html = render("| Plan | Price |\n| --- | --- |");
    expect(html).toContain("<table");
    expect(html).toContain(">Plan</th>");
  });
});
