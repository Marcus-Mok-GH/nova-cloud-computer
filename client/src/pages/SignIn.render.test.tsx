import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import SignIn from "./SignIn";

const pendingSignIn = vi.hoisted(() => ({ email: null as string | null }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false }),
  updateLastActiveTimestamp: vi.fn(),
}));
vi.mock("@/lib/neonAuth", () => ({ neonAuth: null }));
vi.mock("@/lib/trpc", () => ({
  trpc: { useUtils: () => ({ auth: { me: { fetch: vi.fn() } } }) },
}));
vi.mock("@/lib/pendingSignIn", () => ({
  readPendingSignIn: () => pendingSignIn.email,
  rememberPendingSignIn: vi.fn(),
  clearPendingSignIn: vi.fn(),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/sign-in", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

describe("sign-in code step recovery", () => {
  it("offers a resend path when a code is already pending", () => {
    pendingSignIn.email = "visitor@example.com";
    const markup = renderToStaticMarkup(<SignIn />);
    pendingSignIn.email = null;

    expect(markup).toContain("Check your email.");
    // The step used to dead-end: the only exits were typing a code the visitor
    // may never have received, or "Use a different email" for a typo they did
    // not make.
    expect(markup).toContain("Didn&#x27;t get the code? Resend it");
    expect(markup).toContain("Use a different email");
    // Guidance for the two most common reasons the code never shows up.
    expect(markup).toContain("Codes expire after a few minutes.");
    expect(markup).toContain("check your spam folder");
    // The email step itself must not advertise resending before a code exists.
    const emailStep = renderToStaticMarkup(<SignIn />);
    expect(emailStep).not.toContain("Resend it");
  });
});
