import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Deployments from "./Deployments";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ loading: false, user: { name: "Jamie M.", email: "j@n.app" }, logout: vi.fn() }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { workspace: { computer: { useQuery: () => ({ data: { chats: [] }, isError: false, isLoading: false }) } } } }));
vi.mock("wouter", () => ({ useLocation: () => ["/app/deployments", vi.fn()] }));

describe("Deployments page", () => {
  it("renders the release room with production status", () => {
    const markup = renderToStaticMarkup(<Deployments />);
    expect(markup).toContain("Release room");
    expect(markup).toContain("Nova production");
    expect(markup).toContain("main branch");
    expect(markup).toContain("Ready");
  });
});
