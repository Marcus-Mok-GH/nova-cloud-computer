import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: { name: "Test", email: "t@t.com" }, logout: vi.fn() }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workspace: {
      computer: {
        useQuery: () => ({
          data: {
            chats: [{ id: 1, title: "Chat one", updatedAt: new Date().toISOString() }],
            files: [{ id: 1, name: "a.txt" }],
          },
        }),
      },
    },
    useUtils: () => ({ workspace: { computer: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/app/chats", vi.fn()], useSearch: () => "" }));

vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {} }, innerWidth: 1200, addEventListener: () => {} });

import DashboardLayout from "./DashboardLayout";

describe("DashboardLayout single-menu check", () => {
  it("renders the tab menu and NOT the chat-history sidebar on /app/chats", () => {
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).toContain(">Chats<");
    expect(html).not.toContain('aria-label="Chat history"');
    expect(html).not.toContain("Your conversation history");
    // exactly one sidebar
    expect((html.match(/<aside/g) || []).length).toBe(1);
  });
});
