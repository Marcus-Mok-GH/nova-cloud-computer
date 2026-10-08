import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import {
  CodeTaskToolActivity,
  DiffText,
  EditFileDetail,
  EditFileToolActivity,
  LiveActivityCard,
  ResearchToolActivity,
  SolveEquationDetail,
  SolveEquationToolActivity,
  ThinkerDetail,
  ThinkerPromptHeader,
  ThinkerToolActivity,
  ThinkingToolActivity,
  ToolActivityLine,
  ToolActivityPanel,
  ToolRunGroup,
  isPanelToolActivity,
  toolChipContainerClass,
  toolLineText,
} from "./toolActivityLine";
import type { ToolActivity } from "./chatMessages";

const activity = (
  name: string,
  argumentsJson: string,
  state: ToolActivity["state"] = "completed"
): ToolActivity => ({
  id: "t1",
  name,
  state,
  args: { arguments: argumentsJson },
});

describe("toolLineText", () => {
  it("formats read/edit/delete file one-liners", () => {
    expect(toolLineText(activity("read_file", '{"file":"notes.txt"}'))).toBe(
      "Read File notes.txt"
    );
    expect(toolLineText(activity("edit_file", '{"file":"a.md"}'))).toBe(
      "Edit File a.md"
    );
    expect(toolLineText(activity("delete_file", '{"file":"old.log"}'))).toBe(
      "Delete File old.log"
    );
  });

  it("labels the ultraplan plan tools", () => {
    expect(toolLineText(activity("create_plan", '{"content":"# Plan"}'))).toBe(
      "Create Plan"
    );
    expect(toolLineText(activity("edit_plan", '{"content":"# Plan"}'))).toBe(
      "Edit Plan"
    );
  });

  it("formats folder and rename/move one-liners", () => {
    expect(toolLineText(activity("create_folder", '{"name":"Projects"}'))).toBe(
      "Create Folder Projects"
    );
    expect(
      toolLineText(
        activity("rename_file", '{"file":"a.txt","new_name":"b.txt"}')
      )
    ).toBe("Rename File a.txt → b.txt");
    expect(
      toolLineText(activity("move_file", '{"file":"a.txt","folder":"Archive"}'))
    ).toBe("Move File a.txt → Archive");
    expect(
      toolLineText(
        activity("move_folder", '{"folder":"Drafts","parent":"Archive"}')
      )
    ).toBe("Move Folder Drafts → Archive");
  });

  it("formats workspace and telegram/vm one-liners", () => {
    expect(toolLineText(activity("list_workspace", "{}"))).toBe("List Files");
    expect(
      toolLineText(activity("send_telegram_message", '{"text":"hello world"}'))
    ).toBe("Send Telegram Message: hello world");
    expect(
      toolLineText(activity("run_vm_task", '{"task":"install deps"}'))
    ).toBe("Run VM Task: install deps");
  });

  it("formats editor one-liners with the task, including legacy code_task rows", () => {
    expect(
      toolLineText(activity("editor", '{"task":"write a debounce helper"}'))
    ).toBe("Editor: write a debounce helper");
    expect(toolLineText(activity("editor", "{}"))).toBe("Editor");
    expect(
      toolLineText(activity("code_task", '{"task":"write a debounce helper"}'))
    ).toBe("Editor: write a debounce helper");
    expect(toolLineText(activity("code_task", "{}"))).toBe("Editor");
  });

  it("formats solve_equation one-liners with the expression", () => {
    expect(
      toolLineText(
        activity("solve_equation", '{"equation":"20 - (5*2 + 2*(2/3))"}')
      )
    ).toBe("Solve: 20 - (5*2 + 2*(2/3))");
    expect(toolLineText(activity("solve_equation", "{}"))).toBe("Solve");
    expect(
      toolLineText(
        activity("solve_equation", '{"equation":"' + "x".repeat(200) + '"}')
      )
    ).toBe(`Solve: ${"x".repeat(59)}…`);
  });

  it("formats browse one-liners with the command", () => {
    expect(
      toolLineText(activity("browse", '{"command":"open https://example.com"}'))
    ).toBe("Browse: open https://example.com");
    expect(
      toolLineText(activity("browse", '{"command":"agent-browser snapshot"}'))
    ).toBe("Browse: snapshot");
    expect(toolLineText(activity("browse", "{}"))).toBe("Browse");
  });

  it("falls back gracefully on unknown names and malformed args", () => {
    expect(toolLineText(activity("mystery_tool", '{"x":1}'))).toBe(
      "mystery_tool"
    );
    expect(toolLineText(activity("read_file", '{"file":"notes.txt"'))).toBe(
      "Read File"
    );
    expect(
      toolLineText({ id: "t2", name: "read_file", state: "running", args: {} })
    ).toBe("Read File");
  });

  it("formats research_web one-liners with the topic", () => {
    expect(
      toolLineText(
        activity(
          "research_web",
          '{"topic":"solid-state vs sodium-ion","difficulty":"deep"}'
        )
      )
    ).toBe("Deep Research: solid-state vs sodium-ion");
    expect(toolLineText(activity("research_web", "{}"))).toBe("Deep Research");
    expect(
      toolLineText(
        activity("research_web", '{"topic":"' + "x".repeat(200) + '"}')
      )
    ).toBe(`Deep Research: ${"x".repeat(59)}…`);
  });

  it("formats thinker one-liners with the question", () => {
    expect(
      toolLineText(
        activity(
          "thinker",
          '{"question":"should we add a cache?","context":"500 rps"}'
        )
      )
    ).toBe("Thinker: should we add a cache?");
    expect(toolLineText(activity("thinker", "{}"))).toBe("Thinker");
    expect(
      toolLineText(
        activity("thinker", '{"question":"' + "x".repeat(200) + '"}')
      )
    ).toBe(`Thinker: ${"x".repeat(59)}…`);
  });

  it("truncates long telegram/vm text", () => {
    const long = "x".repeat(200);
    const line = toolLineText(
      activity("send_telegram_message", `{"text":"${long}"}`)
    );
    expect(line.length).toBeLessThanOrEqual(
      "Send Telegram Message: ".length + 60
    );
  });

  it("formats the editor specialist's own tool calls", () => {
    expect(toolLineText(activity("list_files", "{}"))).toBe("List Files");
    expect(toolLineText(activity("write_file", '{"path":"index.html"}'))).toBe(
      "Write File index.html"
    );
    expect(toolLineText(activity("read_file", '{"path":"src/main.py"}'))).toBe(
      "Read File src/main.py"
    );
    expect(
      toolLineText(activity("run_command", '{"command":"npm test"}'))
    ).toBe("Run Command: npm test");
    expect(toolLineText(activity("run_command", "{}"))).toBe("Run Command");
  });
});

describe("EditFileToolActivity", () => {
  const edit = (
    state: ToolActivity["state"],
    diff?: string
  ): ToolActivity => ({
    id: "e1",
    name: "edit_file",
    state,
    args: { arguments: '{"file":"notes.md","content":"Hello, updated!"}' },
    ...(diff ? { diff } : {}),
  });

  it("tints added lines green, removed lines red, and the hunk header muted", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiffText, {
        diff: "@@ -1,1 +1,1 @@\n-Hello\n+Hello, updated!",
      })
    );
    expect(html).toContain("edit-file-diff");
    expect(html).toContain("-Hello");
    expect(html).toContain("+Hello, updated!");
    expect(html).toContain("text-emerald-600");
    expect(html).toContain("text-red-600");
    expect(html).toContain("@@ -1,1 +1,1 @@");
  });

  it("starts open while running with the live note, not the diff", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditFileToolActivity, {
        activity: edit("running"),
      })
    );
    expect(html).toContain("edit-file-detail-panel");
    expect(html).toContain("The edit is being applied…");
    expect(html).toContain("Edit File notes.md");
  });

  it("renders collapsed with a chevron once completed, ready to reveal the diff", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditFileToolActivity, {
        activity: edit("completed", "@@ -1,1 +1,1 @@\n-Hello\n+Hello, updated!"),
      })
    );
    expect(html).not.toContain("edit-file-detail-panel"); // default closed, toggleable via the chevron
    expect(html).toContain("Edit File notes.md");
    expect(html).toContain('aria-expanded="false"');
  });

  it("says there was no change when the edit wrote the same content back", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditFileDetail, { activity: edit("completed") })
    );
    expect(html).toContain("No changes");
  });

  it("shows the real failure reason when the edit failed", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditFileDetail, {
        activity: {
          id: "e2",
          name: "edit_file",
          state: "failed",
          args: { arguments: '{"file":"a.ts"}' },
          detail: "Could not edit a.ts.",
        },
      })
    );
    expect(html).toContain("Could not edit a.ts.");
    expect(html).toContain("text-red-600");
  });

  it("renders through the shared panel dispatch so persisted rows stay panels", () => {
    expect(isPanelToolActivity("edit_file")).toBe(true);
    const html = renderToStaticMarkup(
      React.createElement(ToolActivityPanel, {
        activity: edit("running"),
      })
    );
    expect(html).toContain('data-testid="edit-file-tool-activity"');
  });
});

describe("ResearchToolActivity", () => {
  const research = (
    state: ToolActivity["state"],
    detail?: string
  ): ToolActivity => ({
    id: "r1",
    name: "research_web",
    state,
    args: { arguments: '{"topic":"python versions","difficulty":"deep-lite"}' },
    detail,
  });

  it("starts open while running and streams the live progress note", () => {
    const html = renderToStaticMarkup(
      React.createElement(ResearchToolActivity, {
        activity: research(
          "running",
          "Exa deep research (deep) is reading the live web - 20s elapsed…"
        ),
      })
    );
    expect(html).toContain("research-detail-panel");
    expect(html).toContain("20s elapsed");
    expect(html).toContain("Deep Research: python versions");
  });

  it("renders collapsed with a chevron once completed, ready to reveal the report", () => {
    const completed = research(
      "completed",
      "The report says Python 3.14.7 is latest.\n\nAll sources consulted by the researcher:\n1. python.org - https://python.org"
    );
    const html = renderToStaticMarkup(
      React.createElement(ResearchToolActivity, { activity: completed })
    );
    expect(html).not.toContain("research-detail-panel"); // default closed, toggleable via the chevron
    expect(html).toContain("Deep Research: python versions");
    expect(html).toContain('aria-expanded="false"');
  });

  it("falls back to the starting note while running without progress yet", () => {
    const html = renderToStaticMarkup(
      React.createElement(ResearchToolActivity, {
        activity: research("running"),
      })
    );
    expect(html).toContain("Exa deep research is starting its web searches…");
  });
});

describe("ThinkerToolActivity", () => {
  const thinker = (
    state: ToolActivity["state"],
    detail?: string,
    progressLog?: string[]
  ): ToolActivity => ({
    id: "th1",
    name: "thinker",
    state,
    args: {
      arguments:
        '{"question":"Should we add a cache?","context":"500 rps"}',
    },
    detail,
    ...(progressLog ? { progressLog } : {}),
  });

  it("starts open while running and streams the live progress notes", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerToolActivity, {
        activity: thinker("running", undefined, [
          "The thinker sub-agent is reasoning through the question…",
          "The thinker sub-agent is still reasoning - 30s elapsed…",
        ]),
      })
    );
    expect(html).toContain("thinker-detail-panel");
    expect(html).toContain("30s elapsed");
    expect(html).toContain("Thinker: Should we add a cache?");
  });

  it("falls back to the starting note while running without progress yet", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerToolActivity, {
        activity: thinker("running"),
      })
    );
    expect(html).toContain("reasoning through the question");
  });

  it("shows the full question and context in the panel header", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerToolActivity, {
        activity: thinker("running"),
      })
    );
    expect(html).toContain("Question");
    expect(html).toContain("Should we add a cache?");
    expect(html).toContain("Context");
    expect(html).toContain("500 rps");
    // A short context needs no expand toggle.
    expect(html).not.toContain("Show more");
  });

  it("clamps a long context behind a Show more toggle", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerPromptHeader, {
        question: "Should we add a cache?",
        context: "x".repeat(400),
      })
    );
    expect(html).toContain("line-clamp-3");
    expect(html).toContain("Show more");
    expect(html).toContain('aria-expanded="false"');
  });

  it("omits the context block when only the question was provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerPromptHeader, {
        question: "Is this plan sound?",
        context: "",
      })
    );
    expect(html).toContain("Is this plan sound?");
    expect(html).not.toContain("Context");
  });

  it("renders no header at all when neither the question nor the context survived", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerToolActivity, {
        activity: {
          id: "th-empty",
          name: "thinker",
          state: "running",
          args: {},
        },
      })
    );
    expect(html).not.toContain("Question");
    expect(html).not.toContain("Context");
  });

  it("renders collapsed with a chevron once completed, ready to reveal the analysis", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerToolActivity, {
        activity: thinker(
          "completed",
          "## Findings\n\nYes - add a short TTL cache."
        ),
      })
    );
    expect(html).not.toContain("thinker-detail-panel"); // default closed, toggleable via the chevron
    expect(html).toContain("Thinker: Should we add a cache?");
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows the full analysis rendered as markdown when expanded", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerDetail, {
        activity: thinker(
          "completed",
          "## Findings\n\nYes - add a short TTL cache."
        ),
      })
    );
    expect(html).toContain("Findings");
    expect(html).toContain("Yes - add a short TTL cache.");
  });

  it("shows the real failure reason when the thinker went down", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkerDetail, {
        activity: thinker(
          "failed",
          "The thinker sub-agent is not configured on this workspace."
        ),
      })
    );
    expect(html).toContain("not configured on this workspace");
    expect(html).toContain("text-red-600");
  });

  it("renders through the shared panel dispatch so persisted rows stay panels", () => {
    expect(isPanelToolActivity("thinker")).toBe(true);
    const html = renderToStaticMarkup(
      React.createElement(ToolActivityPanel, {
        activity: thinker("running"),
      })
    );
    expect(html).toContain('data-testid="thinker-tool-activity"');
  });
});

describe("panel width containment on narrow screens", () => {
  it("keeps the research detail panel from stretching past its container when the report has a long unbroken code line", () => {
    const research: ToolActivity = {
      id: "r2",
      name: "research_web",
      state: "running", // running starts the panel open so the detail markup renders
      args: { arguments: '{"topic":"long line test"}' },
      detail: "```\n" + "x".repeat(500) + "\n```",
    };
    const html = renderToStaticMarkup(
      React.createElement(ResearchToolActivity, { activity: research })
    );
    // The panel must clip/scroll its own overflow (min-w-0 + overflow-x-hidden)
    // instead of letting a long unbroken line force the panel - and the whole
    // chat bubble - wider than the screen.
    expect(html).toMatch(
      /research-detail-panel"[^>]*class="[^"]*min-w-0[^"]*overflow-x-hidden/
    );
  });
});

describe("CodeTaskToolActivity", () => {
  const codeTask = (
    state: ToolActivity["state"],
    detail?: string
  ): ToolActivity => ({
    id: "c1",
    name: "editor",
    state,
    args: {
      arguments:
        '{"task":"write a traffic-jam game in HTML","language":"HTML"}',
    },
    detail,
  });

  it("starts open while running and shows the full task with the live progress note", () => {
    const html = renderToStaticMarkup(
      React.createElement(CodeTaskToolActivity, {
        activity: codeTask(
          "running",
          "The editor is working on your task - 30s elapsed…"
        ),
      })
    );
    expect(html).toContain("code-task-detail-panel");
    expect(html).toContain("write a traffic-jam game in HTML");
    expect(html).toContain("30s elapsed");
    expect(html).toContain("Editor: write a traffic-jam game in HTML");
  });

  it("renders collapsed with a chevron once completed, ready to reveal the code", () => {
    const html = renderToStaticMarkup(
      React.createElement(CodeTaskToolActivity, {
        activity: codeTask(
          "completed",
          "<!DOCTYPE html>\n<html><body>game</body></html>"
        ),
      })
    );
    expect(html).not.toContain("code-task-detail-panel"); // default closed, toggleable via the chevron
    expect(html).toContain("Editor: write a traffic-jam game in HTML");
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows the specialist failure reason when the task failed", () => {
    const html = renderToStaticMarkup(
      React.createElement(CodeTaskToolActivity, {
        activity: codeTask(
          "failed",
          "The coding specialist failed: NIM is down."
        ),
      })
    );
    expect(html).not.toContain("code-task-detail-panel");
    expect(html).toContain("(failed)");
  });

  it("survives malformed arguments without crashing", () => {
    const broken: ToolActivity = {
      id: "c2",
      name: "editor",
      state: "completed",
      args: { arguments: '{"task":"unclosed' },
      detail: "console.log(1)",
    };
    const html = renderToStaticMarkup(
      React.createElement(CodeTaskToolActivity, { activity: broken })
    );
    expect(html).toContain('data-testid="code-task-tool-activity"');
    expect(html).toContain("Editor"); // header falls back to the bare tool name
    expect(html).toContain('aria-expanded="false"');
  });
});

describe("SolveEquationToolActivity", () => {
  const solve = (
    state: ToolActivity["state"],
    detail?: string
  ): ToolActivity => ({
    id: "s1",
    name: "solve_equation",
    state,
    args: { arguments: '{"equation":"20 - (5*2 + 2*(2/3))"}' },
    detail,
  });

  it("starts open while running with a live evaluating note", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolveEquationToolActivity, {
        activity: solve("running"),
      })
    );
    expect(html).toContain("solve-equation-detail-panel");
    expect(html).toContain("Evaluating");
    expect(html).toContain("Solve: 20 - (5*2 + 2*(2/3))");
  });

  it("renders collapsed with a chevron once completed, showing input and output when open", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolveEquationToolActivity, {
        activity: solve("completed", "20 - (5*2 + 2*(2/3)) = 8.3333"),
      })
    );
    // Default closed, toggleable via the chevron.
    expect(html).not.toContain("solve-equation-detail-panel");
    expect(html).toContain("Solve: 20 - (5*2 + 2*(2/3))");
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows the expression as Input and the answer as Output when expanded", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolveEquationDetail, {
        activity: solve("completed", "20 - (5*2 + 2*(2/3)) = 8.3333"),
        equation: "20 - (5*2 + 2*(2/3))",
      })
    );
    expect(html).toContain("Input");
    expect(html).toContain("20 - (5*2 + 2*(2/3))");
    expect(html).toContain("Output");
    expect(html).toContain("= 8.3333");
  });

  it("shows the real error text as the Output when the solve failed", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolveEquationDetail, {
        activity: solve(
          "failed",
          "Could not evaluate '20 +': Unexpected part of the expression."
        ),
        equation: "20 +",
      })
    );
    // renderToStaticMarkup escapes apostrophes as &#x27;, so match around them.
    expect(html).toContain("Could not evaluate");
    expect(html).toContain("Unexpected part of the expression.");
    expect(html).toContain("text-red-600");
  });

  it("falls back to the summary when the result is no longer persisted", () => {
    const html = renderToStaticMarkup(
      React.createElement(SolveEquationDetail, {
        activity: { ...solve("completed"), summary: "Solved: 20 - 11.33." },
        equation: "",
      })
    );
    expect(html).toContain("Solved: 20 - 11.33.");
  });

  it("survives malformed arguments without crashing", () => {
    const broken: ToolActivity = {
      id: "s2",
      name: "solve_equation",
      state: "completed",
      args: { arguments: '{"equation":"unclosed' },
      detail: "20 - 11.33 = 8.67",
    };
    const html = renderToStaticMarkup(
      React.createElement(SolveEquationToolActivity, { activity: broken })
    );
    expect(html).toContain('data-testid="solve-equation-tool-activity"');
    expect(html).toContain("Solve");
    expect(html).toContain('aria-expanded="false"');
  });
});

describe("ToolActivityLine", () => {
  it("renders a compact single line with the one-liner text", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolActivityLine, {
        activity: activity("read_file", '{"file":"notes.txt"}'),
      })
    );
    expect(html).toContain("Read File notes.txt");
    expect(html).toContain('data-testid="tool-activity-line"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Tool activity");
  });

  it("marks failed tools and spins running ones", () => {
    const failed = renderToStaticMarkup(
      React.createElement(ToolActivityLine, {
        activity: activity("create_file", '{"name":"dup.txt"}', "failed"),
      })
    );
    expect(failed).toContain("(failed)");
    const running = renderToStaticMarkup(
      React.createElement(ToolActivityLine, {
        activity: activity("create_file", '{"name":"dup.txt"}', "running"),
      })
    );
    expect(running).toContain("animate-spin");
  });

  it("gives a running tool the bright reply-text color instead of the muted resting tone", () => {
    const running = renderToStaticMarkup(
      React.createElement(ToolActivityLine, {
        activity: activity("create_file", '{"name":"dup.txt"}', "running"),
      })
    );
    expect(running).toContain("text-foreground");
    expect(running).not.toContain("text-muted-foreground");
    const completed = renderToStaticMarkup(
      React.createElement(ToolActivityLine, {
        activity: activity("create_file", '{"name":"dup.txt"}', "completed"),
      })
    );
    expect(completed).toContain("text-muted-foreground");
  });
});

describe("toolChipContainerClass", () => {
  it("gives a running tool a clearly visible card in both variants, not the near-invisible resting tone", () => {
    const running = activity("code_task", '{"task":"x"}', "running");
    const settled = activity("code_task", '{"task":"x"}', "completed");
    for (const variant of ["line", "panel"] as const) {
      const runningClass = toolChipContainerClass(running, variant);
      const settledClass = toolChipContainerClass(settled, variant);
      // The resting style keeps the original near-transparent dark-mode tone;
      // running must be visibly stronger so it does not blend into the page.
      expect(settledClass).toContain("dark:bg-white/[0.04]");
      expect(runningClass).toContain("dark:bg-white/[0.10]");
      expect(runningClass).not.toContain("dark:bg-white/[0.04]");
      expect(runningClass).toContain("border-foreground/[0.18]");
    }
  });

  it("keeps the line/panel-specific layout classes for each variant", () => {
    const running = activity("code_task", '{"task":"x"}', "running");
    expect(toolChipContainerClass(running, "line")).toContain(
      "items-center gap-1"
    );
    expect(toolChipContainerClass(running, "panel")).toContain("flex-col");
  });
});

describe("sub-agent progress log streaming", () => {
  it("renders every streamed progress line while a code task runs", () => {
    const running: ToolActivity = {
      id: "t1",
      name: "editor",
      state: "running",
      args: { arguments: '{"task":"Build the dashboard"}' },
      detail: "The specialist is running: npm test",
      progressLog: [
        "The coding specialist is taking over the task - reading the workspace on its own...",
        "The specialist is listing the workspace files...",
        "The specialist wrote src/dashboard.tsx...",
        "The specialist is running: npm test",
      ],
    };
    const html = renderToStaticMarkup(
      <CodeTaskToolActivity activity={running} />
    );
    expect(html).toContain("The specialist wrote src/dashboard.tsx...");
    expect(html).toContain("The coding specialist is taking over the task");
    expect(html).toContain("npm test");
    // The panel still shows the task it was handed.
    expect(html).toContain("Build the dashboard");
  });

  it("renders every streamed progress line while research runs", () => {
    const running: ToolActivity = {
      id: "t2",
      name: "research_web",
      state: "running",
      args: { arguments: '{"topic":"GLM pool congestion"}' },
      detail: "Writing the report...",
      progressLog: [
        "Deep research is starting its web searches...",
        'Searched the live web - found 3 new sources (e.g. "GLM status")',
        "Evidence gathered from 3 sources - writing the report...",
      ],
    };
    const html = renderToStaticMarkup(
      <ResearchToolActivity activity={running} />
    );
    expect(html).toContain("Deep research is starting its web searches...");
    expect(html).toContain("found 3 new sources");
    expect(html).toContain("Evidence gathered from 3 sources");
  });

  it("falls back to the single detail line when no log has streamed yet", () => {
    const running: ToolActivity = {
      id: "t3",
      name: "research_web",
      state: "running",
      args: { arguments: '{"topic":"q"}' },
      detail: "Exa deep research is starting its web searches...",
    };
    const html = renderToStaticMarkup(
      <ResearchToolActivity activity={running} />
    );
    expect(html).toContain("Exa deep research is starting its web searches...");
  });
});

describe("LiveActivityCard", () => {
  const step = (id: string, state: ToolActivity["state"]): ToolActivity => ({
    id,
    name: "read_file",
    state,
    args: { arguments: `{"file":"${id}.txt"}` },
  });

  it("renders every step when the run is short, with the working header while active", () => {
    const html = renderToStaticMarkup(
      React.createElement(LiveActivityCard, {
        activities: [step("t-1", "completed"), step("t-2", "running")],
        working: true,
      })
    );
    expect(html).toContain('data-testid="live-activity-card"');
    expect(html).toContain("Working");
    expect(html).toContain("2 steps");
    expect(html).toContain("Read File t-1.txt");
    expect(html).toContain("Read File t-2.txt");
    expect(html).not.toContain("earlier step");
  });

  it("folds long histories behind a +N earlier steps toggle, keeping the newest steps visible", () => {
    const activities = [
      step("t-1", "completed"),
      step("t-2", "completed"),
      step("t-3", "completed"),
      step("t-4", "completed"),
      step("t-5", "running"),
    ];
    const html = renderToStaticMarkup(
      React.createElement(LiveActivityCard, { activities, working: true })
    );
    expect(html).toContain("+ 2 earlier steps");
    expect(html).not.toContain("Read File t-1.txt");
    expect(html).not.toContain("Read File t-2.txt");
    expect(html).toContain("Read File t-3.txt");
    expect(html).toContain("Read File t-4.txt");
    expect(html).toContain("Read File t-5.txt");
    expect(html).toContain("5 steps");
  });

  it("counts failed steps in the header so failures stay visible at a glance", () => {
    const html = renderToStaticMarkup(
      React.createElement(LiveActivityCard, {
        activities: [step("t-1", "failed"), step("t-2", "completed")],
        working: false,
      })
    );
    expect(html).toContain("Steps");
    expect(html).toContain("2 steps");
    expect(html).toContain("1 failed");
    expect(html).toContain("(failed)");
  });
});

describe("ToolRunGroup", () => {
  const run = (id: string, state: ToolActivity["state"]): ToolActivity => ({
    id,
    name: "read_file",
    state,
    args: { arguments: `{"file":"${id}.txt"}` },
  });

  it("collapses a settled stretch of tool rows into one quiet Used N tools line", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolRunGroup, {
        activities: [run("t-1", "completed"), run("t-2", "completed")],
      })
    );
    expect(html).toContain('data-testid="tool-run-group"');
    expect(html).toContain("Used 2 tools");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="tool-run-group-detail"');
    expect(html).not.toContain("Read File t-1.txt");
  });

  it("starts open when one of the tools is still running so refreshes keep showing live progress", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolRunGroup, {
        activities: [run("t-1", "completed"), run("t-2", "running")],
      })
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-testid="tool-run-group-detail"');
    expect(html).toContain("Read File t-2.txt");
  });

  it("uses the singular for a single tool and surfaces failures in the summary", () => {
    const single = renderToStaticMarkup(
      React.createElement(ToolRunGroup, { activities: [run("t-1", "failed")] })
    );
    expect(single).toContain("Used 1 tool");
    expect(single).toContain("1 failed");
  });
});

describe("panel detail fallbacks", () => {
  it("renders an element fallback without nesting a paragraph inside a paragraph", () => {
    const thinking: ToolActivity = {
      id: "th1",
      name: "thinking",
      state: "running",
      args: {},
    };
    const html = renderToStaticMarkup(
      React.createElement(ThinkingToolActivity, { activity: thinking })
    );
    expect(html).toContain("The model is thinking…");
    // No <p> directly inside another <p>; the lookahead keeps the svg's
    // <path> elements from counting as one.
    expect(html).not.toMatch(/<p(?![a-zA-Z])[^>]*>\s*<p(?![a-zA-Z])/);
  });

  it("keeps the muted paragraph wrapper for a text fallback", () => {
    const expired: ToolActivity = {
      id: "th2",
      name: "thinker",
      state: "completed",
      args: {},
      summary: "The analysis expired.",
    };
    const html = renderToStaticMarkup(
      React.createElement(ThinkerDetail, { activity: expired })
    );
    expect(html).toContain("The analysis expired.");
    expect(html).toContain("text-xs text-muted-foreground");
  });
});
