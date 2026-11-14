import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { onboarding: { invalidate: vi.fn() } } }),
    auth: {
      saveCountryPrompt: { useMutation: () => ({ isPending: false, mutate }) },
    },
  },
}));

// Radix portals emit nothing under renderToStaticMarkup, so the dialog shell
// is swapped for plain passthrough elements - the prompt's own content is
// what this test is about.
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

import { CountryPromptModal } from "./CountryPromptModal";

describe("CountryPromptModal", () => {
  it("asks the legacy account for its country, with the full ISO list", () => {
    const html = renderToStaticMarkup(
      <CountryPromptModal onClose={() => {}} />
    );
    expect(html).toContain("Which country are you in?");
    expect(html).toContain("switch Nova&#x27;s language");
    // 249 country options + the placeholder.
    expect((html.match(/<option/g) ?? []).length).toBe(249 + 1);
    // Country names render through Intl.DisplayNames in the active locale.
    expect(html).toContain('value="SG"');
    expect(html).toContain(">Singapore<");
    // Both paths close the prompt: answer it, or decline for now.
    expect(html).toContain("Save &amp; continue");
    expect(html).toContain("Maybe later");
  });
});
