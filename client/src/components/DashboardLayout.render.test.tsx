import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import DashboardLayout from "./DashboardLayout";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ loading: false, user: null, logout: vi.fn() }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { workspace: { computer: { useQuery: () => ({ data: undefined, isError: false, isLoading: false }) } } } }));
vi.mock("wouter", () => ({ useLocation: () => ["/app", vi.fn()] }));

describe("logged-out app shell", () => {
  it("shows the sign-in prompt card and never renders protected children", () => {
    const markup = renderToStaticMarkup(<DashboardLayout><div>SECRET CONTENT</div></DashboardLayout>);
    expect(markup).toContain("Sign in to continue");
    expect(markup).toContain("Sign in");
    expect(markup).not.toContain("SECRET CONTENT");
  });
});
