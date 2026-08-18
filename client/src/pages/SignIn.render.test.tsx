import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import SignIn from "./SignIn";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false }),
}));
vi.mock("@/lib/neonAuth", () => ({
  neonAuth: {
    emailOtp: { sendVerificationOtp: vi.fn() },
    signIn: { emailOtp: vi.fn() },
  },
}));
vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
  useLocation: () => ["/sign-in", vi.fn()],
}));

describe("SignIn page", () => {
  it("starts with an email OTP request rather than a magic-link request", () => {
    const markup = renderToStaticMarkup(<SignIn />);
    expect(markup).toContain("Email me a verification code");
    expect(markup).toContain("one-time code");
    expect(markup).not.toContain("sign-in link");
    expect(markup).not.toContain("magic link");
  });
});
