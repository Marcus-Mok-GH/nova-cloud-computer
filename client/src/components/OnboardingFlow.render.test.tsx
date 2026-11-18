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
    DialogHeader: ({ children }: { children?: React.ReactNode }) =>
      createElement("div", null, children),
    DialogTitle: ({ children }: { children?: React.ReactNode }) =>
      createElement("h2", null, children),
    DialogDescription: ({ children }: { children?: React.ReactNode }) =>
      createElement("p", null, children),
  };
});

import {
  OnboardingFlow,
  ONBOARDING_FLOW_SEEN_KEY,
} from "./OnboardingFlow";

const props = { onOpenChange: () => {}, onFinish: () => {} };

describe("OnboardingFlow screens", () => {
  it("opens on what makes Nova different, not a feature tour", () => {
    const html = renderToStaticMarkup(<OnboardingFlow {...props} />);
    expect(html).toContain("Why Nova");
    expect(html).toContain("An agent with a computer, not a chat box.");
    expect(html).toContain("run a terminal");
    expect(html).toContain("1 / 3");
    expect(html).toContain("Give it a job");
    // Each step states its intent.
    expect(html).toContain("Why it matters:");
    expect(html).toContain("the next two steps build on this idea");
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
    expect(html).toContain("2 / 3");
    expect(html).toContain("Continue");
    expect(html).toContain("What happens:");
    expect(html).toContain("your answer becomes the first conversation in your workspace");
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
    expect(html).toContain("3 / 3");
    expect(html).toContain("Skip");
    expect(html).toContain("Start the job");
    expect(html).toContain("Nova reads it before it starts");
  });

  it("exposes the seen-flag key the layout reads", () => {
    expect(ONBOARDING_FLOW_SEEN_KEY).toBe("nova.onboardingFlow.v1");
  });
});
