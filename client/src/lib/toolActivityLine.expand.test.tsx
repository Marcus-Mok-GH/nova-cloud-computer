// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolActivity } from "@/lib/chatMessages";
import { LiveActivityCard, ToolRunGroup } from "./toolActivityLine";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

const read = (id: string, state: ToolActivity["state"]): ToolActivity => ({
  id,
  name: "read_file",
  state,
  args: { arguments: `{"file":"${id}.txt"}` },
});

function buttonWith(text: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll("button")).find(button =>
    (button.textContent ?? "").includes(text)
  );
}

describe("tool expanders default to open", () => {
  it("ToolRunGroup opens a settled run and still collapses on demand", async () => {
    mount(
      <ToolRunGroup
        activities={[read("t-1", "completed"), read("t-2", "completed")]}
      />
    );
    const toggle = container!.querySelector("button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      container!.querySelector('[data-testid="tool-run-group-detail"]')
    ).not.toBeNull();

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      container!.querySelector('[data-testid="tool-run-group-detail"]')
    ).toBeNull();
    expect(container!.textContent).toContain("Finished · 2 steps");

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      container!.querySelector('[data-testid="tool-run-group-detail"]')
    ).not.toBeNull();
  });

  it("opens a long run's group by default and can still fold the step list", async () => {
    const activities = Array.from({ length: 30 }, (_, index) =>
      read(`t-${index + 1}`, index === 0 ? "failed" : "completed")
    );
    mount(<ToolRunGroup activities={activities} />);
    // The group itself opens without a tap, but the step list still folds:
    // the oldest step failed, so it is pinned above the five recent ones.
    expect(
      container!.querySelector('[data-testid="tool-run-group-detail"]')
    ).not.toBeNull();
    expect(container!.textContent).toContain("Didn’t work");
    expect(container!.textContent).toContain("Read File t-1.txt");
    expect(container!.textContent).not.toContain("Read File t-10.txt");

    const expand = buttonWith("earlier step");
    expect(expand).toBeDefined();
    await act(async () => {
      expand!.click();
    });
    expect(container!.textContent).toContain("Read File t-10.txt");
    expect(container!.textContent).toContain("Show fewer");
  });

  it("LiveActivityCard keeps its history folded until asked, then expands", async () => {
    const activities = [1, 2, 3, 4, 5].map(index =>
      read(`t-${index}`, index === 5 ? "running" : "completed")
    );
    mount(<LiveActivityCard activities={activities} working={true} />);
    expect(container!.textContent).not.toContain("Read File t-1.txt");
    expect(container!.textContent).toContain("+ 2 earlier steps");

    const expand = buttonWith("+ 2 earlier steps");
    await act(async () => {
      expand!.click();
    });
    expect(container!.textContent).toContain("Read File t-1.txt");
    expect(container!.textContent).toContain("Show fewer");
  });
});
