import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

// Radix portals emit nothing under renderToStaticMarkup, so the dialog shell
// is swapped for plain passthrough elements - the tour's own steps are what
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

import { OnboardingTour, ONBOARDING_TOUR_SEEN_KEY } from "./OnboardingTour";

describe("OnboardingTour steps", () => {
  it("opens on the welcome step and counts the steps", () => {
    const html = renderToStaticMarkup(
      <OnboardingTour open onOpenChange={() => {}} />
    );
    expect(html).toContain("Step 1 of 6");
    expect(html).toContain("Welcome to Nova");
    expect(html).toContain("Your own cloud workspace with an AI agent.");
    expect(html).toContain("Everything here is private to your account.");
    // The first step has no Back button, and the CTA is Next.
    expect(html).toContain("Next");
    expect(html).not.toContain("Start using Nova");
    expect(html).not.toContain('aria-label="Previous step"');
  });

  it("can open on the final step, which offers the finish action", () => {
    const html = renderToStaticMarkup(
      <OnboardingTour open onOpenChange={() => {}} initialStep={5} />
    );
    expect(html).toContain("Step 6 of 6");
    expect(html).toContain("You\u2019re all set");
    expect(html).toContain("Start using Nova");
    expect(html).toContain('aria-label="Previous step"');
  });

  it("exposes the seen-flag key the layout reads", () => {
    expect(ONBOARDING_TOUR_SEEN_KEY).toBe("nova.onboardingTour.v1");
  });
});
