import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import NotFound from "./NotFound";

vi.mock("wouter", () => ({ useLocation: () => ["/missing", vi.fn()] }));

describe("NotFound page", () => {
  it("renders the 404 card with a go-home action", () => {
    const markup = renderToStaticMarkup(<NotFound />);
    expect(markup).toContain("404");
    expect(markup).toContain("Page Not Found");
    expect(markup).toContain("Go Home");
  });
});
