import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Chats from "./Chats";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ loading: false, user: { name: "Jamie M.", email: "j@n.app" }, logout: vi.fn() }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: { computer: { useQuery: () => ({ data: { chats: [{ id: 1, title: "Launch" }] }, isError: false, isLoading: false }) } },
    chats: { create: { useMutation: () => ({ mutate: vi.fn() }) } },
    useUtils: () => ({ workspace: { computer: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app/chats", vi.fn()] }));

describe("Chats page", () => {
  it("renders the conversation archive and new chat action", () => {
    const markup = renderToStaticMarkup(<Chats />);
    expect(markup).toContain("Conversation archive");
    expect(markup).toContain("New chat");
    expect(markup).toContain("Launch");
  });
});
