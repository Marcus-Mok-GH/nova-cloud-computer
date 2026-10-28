import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Waitlist from "./Waitlist";
import SignInRoute from "./SignInRoute";
import { NOVA_WAITLIST_END_MS } from "@shared/waitlist";

vi.mock("@/components/NovaLogo", () => ({ default: () => <span data-testid="nova-logo" /> }));
// The real sign-in page pulls in the whole tRPC/auth shell; the gate only has to
// decide which page is rendered, so a marker stands in for it here.
vi.mock("./SignIn", () => ({ default: () => <h1>Sign in to Nova.</h1> }));

afterEach(() => {
  vi.useRealTimers();
});

describe("Waitlist page", () => {
  it("promises one launch email and collects an address", () => {
    const markup = renderToStaticMarkup(<Waitlist />);
    expect(markup).toContain("Nova opens on 1 November.");
    expect(markup).toContain('type="email"');
    expect(markup).toContain("you@example.com");
    expect(markup).toContain("Join the waitlist");
    expect(markup).toContain("One launch email.");
  });

  it("never offers a way into the product before launch", () => {
    const markup = renderToStaticMarkup(<Waitlist />);
    expect(markup).not.toContain("Sign in");
    expect(markup).not.toContain("Email me a sign-in code");
  });
});

describe("SignInRoute gate", () => {
  it("shows the waitlist before launch", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOVA_WAITLIST_END_MS - 60_000));
    expect(renderToStaticMarkup(<SignInRoute />)).toContain("Join the waitlist");
  });

  it("restores the real sign-in once Nova is open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOVA_WAITLIST_END_MS));
    expect(renderToStaticMarkup(<SignInRoute />)).toContain("Sign in to Nova.");
  });
});