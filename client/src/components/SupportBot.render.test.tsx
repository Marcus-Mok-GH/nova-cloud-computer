import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import SupportBot from "./SupportBot";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    support: {
      ask: {
        useMutation: () => ({ mutate, isPending: false }),
      },
    },
  },
}));

describe("SupportBot", () => {
  it("renders a closed circular launcher with an accessible label", () => {
    const markup = renderToStaticMarkup(<SupportBot />);
    expect(markup).toContain('aria-label="Ask Nova a question"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("rounded-full");
    // The panel stays closed until the visitor asks for it.
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("Ask a question about Nova");
  });
});
