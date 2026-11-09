import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./Home";
import SignIn from "./SignIn";

const authState = vi.hoisted(() => ({ isAuthenticated: false }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: authState.isAuthenticated,
    loading: false,
  }),
}));
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn(), switchable: true }),
}));
vi.mock("@/lib/neonAuth", () => ({ neonAuth: null }));
vi.mock("@/lib/trpc", () => ({
  trpc: { useUtils: () => ({ auth: { me: { fetch: vi.fn() } } }) },
}));
vi.mock("@/lib/authCallbackUrl", () => ({
  getMagicLinkCallbackUrl: () => "http://localhost/cb",
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

afterEach(() => {
  authState.isAuthenticated = false;
});

describe("landing and sign-in render", () => {
  it("renders the task prompt with the top menu", () => {
    const markup = renderToStaticMarkup(<Home />);
    // The prompt hero.
    expect(markup).toContain("What does");
    expect(markup).toContain("need done?");
    expect(markup).toContain("Describe a task to start a session...");
    expect(markup).toContain("Nova Lite");
    expect(markup).toContain("My Nova");
    expect(markup).toContain('aria-label="Start a session"');
    // The top menu survives the rebuild.
    expect(markup).toContain('aria-label="Main navigation"');
    expect(markup).toContain("API docs");
    expect(markup).toContain("Get started");
    expect(markup).toContain("logo-96.png");
  });

  it("no longer renders the retired marketing sections", () => {
    const markup = renderToStaticMarkup(<Home />);
    expect(markup).not.toContain("Work that has somewhere to go.");
    expect(markup).not.toContain("What exactly is Nova?");
    expect(markup).not.toContain("POST /api/v1/chat/completions");
    expect(markup).not.toContain("Inside Nova");
  });

  it("renders the language selectors for guests and signed-in visitors", () => {
    for (const isAuthenticated of [false, true]) {
      authState.isAuthenticated = isAuthenticated;
      const markup = renderToStaticMarkup(<Home />);

      expect(markup).toContain('id="landing-language-desktop"');
      expect(markup).toContain('id="landing-language-mobile"');
      expect(markup).toContain('<option value="es" lang="es">Español</option>');
      expect(markup).toContain(
        isAuthenticated ? "Open workspace" : "Get started"
      );
    }
  });

  it("renders the Zo-style sign-in page", () => {
    const markup = renderToStaticMarkup(<SignIn />);
    expect(markup).toContain("Sign in to Nova.");
    expect(markup).toContain("Email me a sign-in code");
    expect(markup).toContain("you@example.com");
  });
});
