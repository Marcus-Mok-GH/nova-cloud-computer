import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Home from "./Home";
import SignIn from "./SignIn";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false }),
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

describe("landing and sign-in render", () => {
  it("renders the hero and every landing section", () => {
    const markup = renderToStaticMarkup(<Home />);
    // Hero
    expect(markup).toContain("A cloud computer that works while you");
    expect(markup).toContain("Get your own Nova");
    expect(markup).toContain("An agent that works 24/7");
    // Deep-dive rows
    expect(markup).toContain("A real computer, not a chat window");
    expect(markup).toContain("An agent that finishes the job");
    expect(markup).toContain("Work that runs while you don");
    // How it works, channels, pricing, FAQ
    expect(markup).toContain("Start with the thing in front of you.");
    expect(markup).toContain("Nova goes where you already are.");
    expect(markup).toContain("Credits, not surprises.");
    expect(markup).toContain("What exactly is Nova?");
    // Developer callout and footer
    expect(markup).toContain("POST /api/v1/chat/completions");
    expect(markup).toContain("/docs/api");
    expect(markup).toContain(
      "The best place to start is the task you keep opening another tab for."
    );
    // The previous hero must not come back.
    expect(markup).not.toContain("Give your AI a computer of its own.");
  });

  it("optimizes the workspace preview for phones", () => {
    const markup = renderToStaticMarkup(<Home />);
    // The mock window is decorative and hidden from screen readers.
    expect(markup).toContain('aria-hidden="true"');
    // Phones get a single-pane preview; the two-pane workspace returns from sm up.
    expect(markup).toContain(
      "min-h-[300px] grid-cols-1 sm:min-h-[380px] sm:grid-cols-[200px_1fr]"
    );
    expect(markup).toContain(
      "hidden border-r border-border bg-surface p-4 sm:block"
    );
  });

  it("renders the Zo-style sign-in page", () => {
    const markup = renderToStaticMarkup(<SignIn />);
    expect(markup).toContain("Sign in to Nova.");
    expect(markup).toContain("Email me a sign-in code");
    expect(markup).toContain("you@example.com");
  });
});
