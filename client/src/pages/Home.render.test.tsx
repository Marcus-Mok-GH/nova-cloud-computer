import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Home from "./Home";
import SignIn from "./SignIn";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn(), switchable: true }) }));
vi.mock("@/lib/neonAuth", () => ({ neonAuth: null }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ auth: { me: { fetch: vi.fn() } } }) } }));
vi.mock("@/lib/authCallbackUrl", () => ({ getMagicLinkCallbackUrl: () => "http://localhost/cb" }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()], Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

describe("landing and sign-in render", () => {
  it("renders the calmer landing page", () => {
    const markup = renderToStaticMarkup(<Home />);
    expect(markup).toContain("Your work, in one calm place.");
    expect(markup).toContain("Create your workspace");
    expect(markup).toContain("A place that remembers");
    expect(markup).toContain("A little less juggling. A lot more follow-through.");
  });

  it("optimizes the workspace preview for phones", () => {
    const markup = renderToStaticMarkup(<Home />);
    // The mock window is decorative and hidden from screen readers.
    expect(markup).toContain("aria-hidden=\"true\"");
    // Phones get a single-pane preview; the two-pane workspace returns from sm up.
    expect(markup).toContain("min-h-[300px]");
    expect(markup).toContain("min-h-[300px] grid-cols-1 sm:min-h-[390px] sm:grid-cols-[132px_1fr]");
    expect(markup).toContain("hidden border-r border-[#e7e4dc] bg-[#f3f1eb] p-3 sm:block");
  });

  it("renders the Zo-style sign-in page", () => {
    const markup = renderToStaticMarkup(<SignIn />);
    expect(markup).toContain("Sign in to Nova.");
    expect(markup).toContain("Email me a sign-in code");
    expect(markup).toContain("you@example.com");
  });
});
