import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { onboarding: { invalidate: vi.fn() } } }),
    auth: {
      saveOnboarding: { useMutation: () => ({ isPending: false, mutate }) },
    },
  },
}));

// Radix portals emit nothing under renderToStaticMarkup, so the dialog shell
// is swapped for plain passthrough elements - the modal's own content (the
// questions, including the country picker) is what this test is about.
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
    DialogFooter: ({ children }: { children?: React.ReactNode }) =>
      createElement("div", null, children),
  };
});

import { OnboardingModal } from "./OnboardingModal";

describe("OnboardingModal country question", () => {
  it("asks which country the user is in, with the full ISO list", () => {
    const html = renderToStaticMarkup(<OnboardingModal onClose={() => {}} />);
    expect(html).toContain("Which country are you in?");
    // The hint promises the language switch the answer drives.
    expect(html).toContain("language to the one that fits your country");
    // 249 country options + the country placeholder + the experience
    // select's placeholder and four answers.
    expect((html.match(/<option/g) ?? []).length).toBe(249 + 1 + 5);
    // Country names render through Intl.DisplayNames in the active locale.
    expect(html).toContain('value="SG"');
    expect(html).toContain(">Singapore<");
  });
});
