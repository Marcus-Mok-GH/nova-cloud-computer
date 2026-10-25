import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { GoalBadge } from "./GoalBadge";
import type { GoalState } from "@shared/goal";

const goal = (overrides: Partial<GoalState> = {}): GoalState => ({
  objective: "get the landing page to Lighthouse 95",
  status: "active",
  segments: 1,
  ...overrides,
});

const render = (state: GoalState | null) =>
  renderToStaticMarkup(<GoalBadge goal={state} />);

describe("GoalBadge", () => {
  it("stays out of the header when the conversation has no goal", () => {
    expect(render(null)).toBe("");
    expect(render(goal({ objective: "", status: "cleared" }))).toBe("");
    expect(render(goal({ status: "cleared" }))).toBe("");
  });

  it("names the goal and shows what is being chased", () => {
    const markup = render(goal());
    expect(markup).toContain('data-goal-status="active"');
    expect(markup).toContain("Goal");
    expect(markup).toContain("get the landing page to Lighthouse 95");
  });

  it("distinguishes a met goal from a stalled one", () => {
    expect(render(goal({ status: "met" }))).toContain("Goal met");
    expect(render(goal({ status: "unfinished" }))).toContain("Goal stalled");
    expect(render(goal({ status: "met" }))).toContain('data-goal-status="met"');
    expect(render(goal({ status: "unfinished" }))).toContain(
      'data-goal-status="unfinished"'
    );
  });

  it("spells the objective out in full on hover, since the chip truncates", () => {
    const markup = render(goal());
    expect(markup).toContain("Goal: get the landing page to Lighthouse 95");
  });
});
