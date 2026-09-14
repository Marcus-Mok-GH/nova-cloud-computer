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
    // the only asides are the mobile drawer and desktop rail, both workspace navigation
    expect((html.match(/<aside/g) || []).length).toBe(2);
    expect((html.match(/aria-label="Workspace navigation"/g) || []).length).toBe(2);
    // the mobile drawer is hidden from md up and the desktop rail only shows from md up
    expect(html).toContain("md:hidden");
    expect(html).toContain("hidden border-r border-border bg-muted/40");
    // content is full width on phones (left padding only from md)
    expect(html).toMatch(/<main class="min-h-0 min-w-0 flex-1[^"]*md:pl-/);
  });
});
