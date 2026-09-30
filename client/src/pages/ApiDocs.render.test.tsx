import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import ApiDocs from "./ApiDocs";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn(), switchable: true }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/docs/api", vi.fn()] }));

describe("API docs page", () => {
  it("renders for signed-out visitors without redirecting", () => {
    const markup = renderToStaticMarkup(<ApiDocs />);
    expect(markup).toContain("API documentation");
    expect(markup).toContain("Put Nova inside the work you already do.");
  });

  it("documents the v1 endpoints", () => {
    const markup = renderToStaticMarkup(<ApiDocs />);
    expect(markup).toContain("/chat/completions");
    expect(markup).toContain("/models");
    expect(markup).toContain("nova_sk_");
  });

  it("shows a sign-up call to action instead of a login wall", () => {
    const markup = renderToStaticMarkup(<ApiDocs />);
    expect(markup).toContain("Get started");
    expect(markup).not.toContain("Sign in to view");
  });
});
