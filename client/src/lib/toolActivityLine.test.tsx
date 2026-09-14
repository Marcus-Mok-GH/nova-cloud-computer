import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { ToolActivityLine, toolLineText } from "./toolActivityLine";
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

  it("truncates long telegram/vm text", () => {
    const long = "x".repeat(200);
    const line = toolLineText(activity("send_telegram_message", `{"text":"${long}"}`));
    expect(line.length).toBeLessThanOrEqual("Send Telegram Message: ".length + 60);
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
