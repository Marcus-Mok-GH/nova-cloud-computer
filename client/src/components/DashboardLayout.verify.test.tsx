import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

let mockUser: { name: string; email: string; role?: "user" | "admin" | "developer" } = { name: "Test", email: "t@t.com" };
let mockErrorLogs: unknown[] = [];
let mockPath = "/app/chats";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: mockUser, logout: vi.fn() }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      setUsername: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      onboarding: { useQuery: () => ({ data: { completed: true, source: null, useCase: null, experience: null } }) },
    },
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
    credits: { status: { useQuery: () => ({ data: { remainingCredits: 500, dailyCredits: 500, creditValueCents: 1 } }) } },
    admin: { apiErrorLogs: { useQuery: () => ({ data: mockErrorLogs }) } },
    useUtils: () => ({ workspace: { computer: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => [mockPath, vi.fn()], useSearch: () => "" }));

vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {} }, innerWidth: 1200, addEventListener: () => {} });

import DashboardLayout from "./DashboardLayout";

describe("DashboardLayout single-menu check", () => {
  it("renders the tab menu and NOT the chat-history sidebar on /app/chats", () => {
    mockUser = { name: "Test", email: "t@t.com" };
    mockErrorLogs = [];
    mockPath = "/app/chats";
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
    // the desktop rail is a fully opaque surface (no see-through background)
    expect(html).toContain("hidden border-r border-border bg-muted ");
    // content is full width on phones (left padding only from md)
    expect(html).toMatch(/<main class="min-h-0 min-w-0 flex-1[^"]*md:pl-/);
  });
});

describe("DashboardLayout operator navigation", () => {
  it("shows an always-visible Notifications entry with a count badge for admins", () => {
    mockUser = { name: "Owner", email: "owner@example.com", role: "admin" };
    mockErrorLogs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    mockPath = "/app";
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain(">Notifications<");
    expect(html).toContain('aria-label="Notifications, 3 unread"');
    expect(html).toContain(">Admin<");
  });

  it("shows the Notifications entry for developers too", () => {
    mockUser = { name: "Dev", email: "dev@example.com", role: "developer" };
    mockErrorLogs = [];
    mockPath = "/app";
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain(">Notifications<");
    // no badge pill when there are no errors
    expect(html).not.toContain("unread");
  });

  it("hides the Admin and Notifications entries from standard users", () => {
    mockUser = { name: "Test", email: "t@t.com", role: "user" };
    mockErrorLogs = [{ id: 1 }];
    mockPath = "/app";
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).not.toContain(">Admin<");
    expect(html).not.toContain(">Notifications<");
  });

  it("marks the Notifications entry active on its route", () => {
    mockUser = { name: "Owner", email: "owner@example.com", role: "admin" };
    mockErrorLogs = [];
    mockPath = "/app/admin/notifications";
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain('aria-label="Notifications"');
    // the notifications button carries aria-current="page" on its route
    expect(html).toMatch(/aria-label="Notifications"[^>]*aria-current="page"|aria-current="page"[^>]*aria-label="Notifications"/);
  });
});
