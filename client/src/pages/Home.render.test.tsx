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

  it("renders the Zo-style sign-in page", () => {
    const markup = renderToStaticMarkup(<SignIn />);
    expect(markup).toContain("Sign in to Nova.");
    expect(markup).toContain("Email me a sign-in code");
    expect(markup).toContain("you@example.com");
  });
});
