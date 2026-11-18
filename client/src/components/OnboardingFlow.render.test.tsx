import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    chats: {
      create: { useMutation: () => ({ isPending: false, mutateAsync }) },
    },
  },
}));

// Radix portals emit nothing under renderToStaticMarkup, so the dialog shell
// is swapped for plain passthrough elements - the flow's own screens are what
// this test is about.
vi.mock("@/components/ui/dialog", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    Dialog: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
    DialogContent: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => createElement("div", { className }, children),
  };
});

import {
  OnboardingFlow,
  ONBOARDING_FLOW_SEEN_KEY,
} from "./OnboardingFlow";

const props = { onOpenChange: () => {}, onFinish: () => {} };
const STEP_ORDER_LENGTH = 3;

describe("OnboardingFlow screens", () => {
  it("opens on what makes Nova different, with the workspace on show", () => {
    const html = renderToStaticMarkup(<OnboardingFlow {...props} />).replace(
      new RegExp(String.fromCharCode(160), "g"),
      " "
    );
    expect(html).toContain("Why Nova");
    expect(html).toContain("An agent with a computer, not a chat box.");
    expect(html).toContain("runs a terminal");
    expect(html).toContain("Give it a job");
    // Each step states its intent.
    expect(html).toContain("Why it matters:");
    expect(html).toContain("the next two steps build on this.");
    // A real product visual, not a schematic.
    expect(html).toContain('src="/landing/workspace-home.png"');
    // Every step names itself.
    expect(html).toContain("Why Nova");
    // The page control carries one dot per step.
    expect(html.split("rounded-full transition-all duration-300").length - 1).toBe(
      STEP_ORDER_LENGTH
    );
    // Dressed in the iOS system language, not the editorial brand.
    expect(html).toContain("ios-font");
    expect(html).toContain("ios-grouped");
    expect(html).toContain("ios-glass");
    expect(html).toContain("ios-card");
    expect(html).toContain("Step 1 of 3");
    expect(html).toContain('aria-current="step"');
    // No borrowed planner language.
    expect(html).not.toContain("putting off");
    expect(html).not.toContain("Brain dump");
  });

  it("asks for a Nova job and offers Nova's own starting points", () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow {...props} initialStep="job" />
    );
    expect(html).toContain("Its first job");
    expect(html).toContain("What’s the first thing you want Nova to do?");
    expect(html).toContain("Continue");
    expect(html).toContain("What happens:");
    expect(html).toContain(
      "your answer becomes the first conversation in your workspace"
    );
    expect(html).toContain('src="/landing/workspace-chat.png"');
    // The same starters the workspace prompt screen offers.
    expect(html).toContain("Research a question and save the answer as a file");
    expect(html).toContain("Schedule a daily recap of my tasks at 9 AM");
  });

  it("asks for background as the last step", () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow {...props} initialStep="context" />
    );
    expect(html).toContain("The background");
    expect(html).toContain("What should Nova know about it?");
    expect(html).toContain("Skip");
    expect(html).toContain("Start the job");
    expect(html).toContain("Nova reads it before it starts");
    expect(html).toContain('src="/landing/workspace-automations.png"');
  });

  it("exposes the seen-flag key the layout reads", () => {
    expect(ONBOARDING_FLOW_SEEN_KEY).toBe("nova.onboardingFlow.v1");
  });
});
