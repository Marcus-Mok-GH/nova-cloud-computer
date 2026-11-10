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
  it("renders the hero and every landing section", () => {
    const markup = renderToStaticMarkup(<Home />);
    // Hero
    expect(markup).toContain("Work that has somewhere to go.");
    expect(markup).toContain("Get started");
    expect(markup).toContain("Files and chats in one workspace");
    // Deep-dive rows
    expect(markup).toContain("Your work has a place to stay.");
    expect(markup).toContain("From a request to a finished file.");
    expect(markup).toContain("Let the routine take the next turn.");
    // How it works, channels, pricing, FAQ
    expect(markup).toContain("A small handoff can change your whole day.");
    expect(markup).toContain("Keep the conversation close.");
    expect(markup).toContain("Daily credits, or your own model.");
    expect(markup).toContain("What exactly is Nova?");
    // Developer callout and footer
    expect(markup).toContain("POST /api/v1/chat/completions");
    expect(markup).toContain("/docs/api");
    expect(markup).toContain(
      "Start with the task that has been waiting in another tab."
    );
    // The previous hero must not come back.
    expect(markup).not.toContain("Give your AI a computer of its own.");
  });

  it("renders captures from real Nova product screens", () => {
    const markup = renderToStaticMarkup(<Home />);
    expect(markup).toContain('src="/landing/workspace-home.png"');
    expect(markup).toContain('src="/landing/workspace-files.png"');
    expect(markup).toContain('src="/landing/workspace-chat.png"');
    expect(markup).toContain('src="/landing/workspace-automations.png"');
    expect(markup).toContain(
      "Nova&#x27;s file browser with a project document open in the built-in editor."
    );
    expect(markup).toContain('aria-controls="landing-mobile-nav"');
  });

  it("renders the connectors band and the hand-it-a-job section", () => {
    const markup = renderToStaticMarkup(<Home />);
    // Connectors the workspace can actually reach.
    expect(markup).toContain('aria-label="Connected services"');
    expect(markup).toContain(
      "Connect an account once and the agent can work inside it"
    );
    expect(markup).toContain("GitHub");
    expect(markup).toContain("Agent inbox");
    // Jobs section.
    expect(markup).toContain("Bring the task you keep putting off.");
    expect(markup).toContain("Research a question");
    expect(markup).toContain("Keep a routine running");
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
