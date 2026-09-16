import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { ResearchToolActivity, ToolActivityLine, toolLineText } from "./toolActivityLine";
import type { ToolActivity } from "./chatMessages";

const activity = (name: string, argumentsJson: string, state: ToolActivity["state"] = "completed"): ToolActivity =>
  ({ id: "t1", name, state, args: { arguments: argumentsJson } });

describe("toolLineText", () => {
  it("formats read/edit/delete file one-liners", () => {
    expect(toolLineText(activity("read_file", '{"file":"notes.txt"}'))).toBe("Read File notes.txt");
    expect(toolLineText(activity("edit_file", '{"file":"a.md"}'))).toBe("Edit File a.md");
    expect(toolLineText(activity("delete_file", '{"file":"old.log"}'))).toBe("Delete File old.log");
  });

  it("formats folder and rename/move one-liners", () => {
    expect(toolLineText(activity("create_folder", '{"name":"Projects"}'))).toBe("Create Folder Projects");
    expect(toolLineText(activity("rename_file", '{"file":"a.txt","new_name":"b.txt"}'))).toBe("Rename File a.txt → b.txt");
    expect(toolLineText(activity("move_file", '{"file":"a.txt","folder":"Archive"}'))).toBe("Move File a.txt → Archive");
    expect(toolLineText(activity("move_folder", '{"folder":"Drafts","parent":"Archive"}'))).toBe("Move Folder Drafts → Archive");
  });

  it("formats workspace and telegram/vm one-liners", () => {
    expect(toolLineText(activity("list_workspace", "{}"))).toBe("List Files");
    expect(toolLineText(activity("send_telegram_message", '{"text":"hello world"}'))).toBe("Send Telegram Message: hello world");
    expect(toolLineText(activity("run_vm_task", '{"task":"install deps"}'))).toBe("Run VM Task: install deps");
  });

  it("falls back gracefully on unknown names and malformed args", () => {
    expect(toolLineText(activity("mystery_tool", '{"x":1}'))).toBe("mystery_tool");
    expect(toolLineText(activity("read_file", '{"file":"notes.txt"'))).toBe("Read File");
    expect(toolLineText({ id: "t2", name: "read_file", state: "running", args: {} })).toBe("Read File");
  });

  it("formats research_web one-liners with the topic", () => {
    expect(toolLineText(activity("research_web", '{"topic":"solid-state vs sodium-ion","difficulty":"deep"}'))).toBe("Deep Research: solid-state vs sodium-ion");
    expect(toolLineText(activity("research_web", "{}"))).toBe("Deep Research");
    expect(toolLineText(activity("research_web", '{"topic":"' + "x".repeat(200) + '"}'))).toBe(`Deep Research: ${"x".repeat(59)}…`);
  });

  it("truncates long telegram/vm text", () => {
    const long = "x".repeat(200);
    const line = toolLineText(activity("send_telegram_message", `{"text":"${long}"}`));
    expect(line.length).toBeLessThanOrEqual("Send Telegram Message: ".length + 60);
  });
});

describe("ResearchToolActivity", () => {
  const research = (state: ToolActivity["state"], detail?: string): ToolActivity =>
    ({ id: "r1", name: "research_web", state, args: { arguments: '{"topic":"python versions","difficulty":"deep-lite"}' }, detail });

  it("starts open while running and streams the live progress note", () => {
    const html = renderToStaticMarkup(React.createElement(ResearchToolActivity, { activity: research("running", "Exa deep research (deep) is reading the live web — 20s elapsed…") }));
    expect(html).toContain("research-detail-panel");
    expect(html).toContain("20s elapsed");
    expect(html).toContain("Deep Research: python versions");
  });

  it("renders collapsed with a chevron once completed, ready to reveal the report", () => {
    const completed = research("completed", "The report says Python 3.14.7 is latest.\n\nAll sources consulted by the researcher:\n1. python.org — https://python.org");
    const html = renderToStaticMarkup(React.createElement(ResearchToolActivity, { activity: completed }));
    expect(html).not.toContain("research-detail-panel"); // default closed, toggleable via the chevron
    expect(html).toContain("Deep Research: python versions");
    expect(html).toContain("aria-expanded=\"false\"");
  });

  it("falls back to the starting note while running without progress yet", () => {
    const html = renderToStaticMarkup(React.createElement(ResearchToolActivity, { activity: research("running") }));
    expect(html).toContain("Exa deep research is starting its web searches…");
  });
});

describe("ToolActivityLine", () => {
  it("renders a compact single line with the one-liner text", () => {
    const html = renderToStaticMarkup(React.createElement(ToolActivityLine, { activity: activity("read_file", '{"file":"notes.txt"}') }));
    expect(html).toContain("Read File notes.txt");
    expect(html).toContain('data-testid="tool-activity-line"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Tool activity");
  });

  it("marks failed tools and spins running ones", () => {
    const failed = renderToStaticMarkup(React.createElement(ToolActivityLine, { activity: activity("create_file", '{"name":"dup.txt"}', "failed") }));
    expect(failed).toContain("(failed)");
    const running = renderToStaticMarkup(React.createElement(ToolActivityLine, { activity: activity("create_file", '{"name":"dup.txt"}', "running") }));
    expect(running).toContain("animate-spin");
  });
});
