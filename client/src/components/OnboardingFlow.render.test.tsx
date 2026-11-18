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
  it("opens on the why screen, not a feature tour", () => {
    const html = renderToStaticMarkup(<OnboardingFlow {...props} />);
    expect(html).toContain("Why Nova works");
    expect(html).toContain("Your AI shouldn’t just talk. It should work.");
    expect(html).toContain("It should work.");
    expect(html).toContain("1 / 3");
    expect(html).toContain("Let’s put it to work");
    // The reference's lesson: a good onboarding is not a list of features.
    expect(html).not.toContain("Connect GitHub");
  });

  it("asks for one real task before anything else", () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow {...props} initialStep="first" />
    );
    expect(html).toContain("Your first task");
    expect(html).toContain("What’s one thing you’ve been putting off?");
    expect(html).toContain("One thing is enough.");
    expect(html).toContain("2 / 3");
    expect(html).toContain("Add it");
    expect(html).not.toContain("Connect GitHub");
  });

  it("offers a brain dump as the last step", () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow {...props} initialStep="more" />
    );
    expect(html).toContain("Brain dump");
    expect(html).toContain("Anything else on your mind?");
    expect(html).toContain("Dump it all");
    expect(html).toContain("3 / 3");
    expect(html).toContain("Skip");
    expect(html).toContain("Add and open Nova");
  });

  it("exposes the seen-flag key the layout reads", () => {
    expect(ONBOARDING_FLOW_SEEN_KEY).toBe("nova.onboardingFlow.v1");
  });
});
