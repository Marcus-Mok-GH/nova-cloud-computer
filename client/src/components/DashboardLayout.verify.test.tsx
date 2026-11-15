import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

let mockUser: { name: string; email: string; role?: "user" | "admin" | "developer" } = { name: "Test", email: "t@t.com" };
let mockErrorLogs: unknown[] = [];
let mockPath = "/app/chats";
/** The billing.subscription payload the plan badge reads; null = still loading. */
let mockSubscription: { plan: "free" | "paid"; proAccess?: boolean } | null = {
  plan: "free",
};
/** The auth.onboarding payload; `needsCountry` gates the one-shot prompt. */
let mockOnboarding: {
  completed: boolean;
  source: string | null;
  useCase: string | null;
  experience: string | null;
  country: string | null;
  needsCountry: boolean;
} = {
  completed: true,
  source: null,
  useCase: null,
  experience: null,
  country: null,
  needsCountry: false,
};

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: mockUser, logout: vi.fn() }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      setUsername: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      onboarding: { useQuery: () => ({ data: mockOnboarding }) },
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
    billing: { subscription: { useQuery: () => ({ data: mockSubscription }) } },
    admin: { apiErrorLogs: { useQuery: () => ({ data: mockErrorLogs }) } },
    useUtils: () => ({ workspace: { computer: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));
// The prompt itself has its own render test; this file only gates WHEN it
// shows, and a Radix portal emits nothing under renderToStaticMarkup.
vi.mock("./CountryPromptModal", async () => {
  const { createElement } = await import("react");
  return {
    CountryPromptModal: () => createElement("div", null, "Country prompt shown"),
  };
});
vi.mock("wouter", () => ({ useLocation: () => [mockPath, vi.fn()], useSearch: () => "" }));

vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {} }, innerWidth: 1200, addEventListener: () => {} });

import DashboardLayout, { planRows } from "./DashboardLayout";

describe("planRows", () => {
  it("lists every tier for a free account, with Plus and Pro locked", () => {
    expect(planRows(false, false, "free")).toEqual([
      { id: "free", labelKey: "layout.plan.free", current: true, locked: false },
      { id: "plus", labelKey: "layout.plan.plus", current: false, locked: true },
      { id: "pro", labelKey: "layout.plan.pro", current: false, locked: true },
    ]);
  });

  it("marks Plus as current for a Plus subscriber, with Pro still locked", () => {
    expect(planRows(false, false, "plus")).toEqual([
      { id: "free", labelKey: "layout.plan.free", current: false, locked: false },
      { id: "plus", labelKey: "layout.plan.plus", current: true, locked: false },
      { id: "pro", labelKey: "layout.plan.pro", current: false, locked: true },
    ]);
  });

  it("marks Pro as current for a Pro subscriber, with nothing locked", () => {
    expect(planRows(true, false, "paid")).toEqual([
      { id: "free", labelKey: "layout.plan.free", current: false, locked: false },
      { id: "plus", labelKey: "layout.plan.plus", current: false, locked: false },
      { id: "pro", labelKey: "layout.plan.pro", current: true, locked: false },
    ]);
  });

  it("lets an operator's Pro access outrank their Plus subscription", () => {
    // Operators read proAccess true from the server regardless of their
    // subscription, so Pro is the current tier and nothing reads locked.
    expect(planRows(true, false, "plus")).toEqual([
      { id: "free", labelKey: "layout.plan.free", current: false, locked: false },
      { id: "plus", labelKey: "layout.plan.plus", current: false, locked: false },
      { id: "pro", labelKey: "layout.plan.pro", current: true, locked: false },
    ]);
  });

  it("adds the admin tier for admin accounts, with Pro unlocked through their Pro access", () => {
    expect(planRows(true, true, "paid")).toEqual([
      { id: "free", labelKey: "layout.plan.free", current: false, locked: false },
      { id: "plus", labelKey: "layout.plan.plus", current: false, locked: false },
      { id: "pro", labelKey: "layout.plan.pro", current: false, locked: false },
      { id: "admin", labelKey: "layout.plan.admin", current: true, locked: false },
    ]);
  });

  it("keeps Pro locked for an operator the server did not grant Pro access", () => {
    // Unreachable in practice (the server sets proAccess for operators);
    // documents the row-derivation when the flag and the role disagree.
    expect(planRows(false, true, "free")).toEqual([
      { id: "free", labelKey: "layout.plan.free", current: false, locked: false },
      { id: "plus", labelKey: "layout.plan.plus", current: false, locked: true },
      { id: "pro", labelKey: "layout.plan.pro", current: false, locked: true },
      { id: "admin", labelKey: "layout.plan.admin", current: true, locked: false },
    ]);
  });
});

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
    expect(html).toContain("hidden border-e border-border bg-muted ");
    // content is full width on phones (left padding only from md)
    expect(html).toMatch(/<main class="min-h-0 min-w-0 flex-1[^"]*md:ps-/);
  });
});

describe("DashboardLayout plan badge", () => {
  it("shows Pro beside the wordmark for a paid account, in the display serif", () => {
    mockUser = { name: "Test", email: "t@t.com", role: "user" };
    mockPath = "/app";
    mockSubscription = { plan: "paid", proAccess: true };
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain('aria-label="Your plan"');
    expect(html).toContain(">Pro<");
    // The trigger shows the account's own tier only, never a list.
    expect(html).not.toContain(">Free</button>");
    // The trigger uses the brand display serif (DM Serif Display, weight 400
    // only — a font-bold serif would synthesise a doubled weight).
    expect(html).toMatch(/aria-label="Your plan"[\s\S]{0,400}nova-display/);
  });

  it("shows Free beside the wordmark for a free account", () => {
    mockUser = { name: "Test", email: "t@t.com", role: "user" };
    mockPath = "/app";
    mockSubscription = { plan: "free" };
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain('aria-label="Your plan"');
    expect(html).toContain(">Free<");
    expect(html).not.toContain(">Pro<");
  });

  it("shows Admin beside the wordmark for an admin account, even on a free subscription", () => {
    mockUser = { name: "Owner", email: "owner@example.com", role: "admin" };
    mockPath = "/app";
    mockSubscription = { plan: "free", proAccess: true };
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain('aria-label="Your plan"');
    // The admin tier is the account's own, so it is what the trigger shows.
    expect(html).toContain(">Admin<");
    expect(html).not.toContain(">Free<");
    expect(html).not.toContain(">Pro<");
  });

  it("shows no admin tier to a standard user", () => {
    mockUser = { name: "Test", email: "t@t.com", role: "user" };
    mockPath = "/app";
    mockSubscription = { plan: "paid", proAccess: true };
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).not.toContain(">Admin<");
  });

  it("renders no plan label until the plan is known, so a paying account never flashes Free", () => {
    mockUser = { name: "Test", email: "t@t.com", role: "user" };
    mockPath = "/app";
    mockSubscription = null;
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain('aria-label="Your plan"');
    expect(html).not.toContain(">Free<");
    expect(html).not.toContain(">Pro<");
  });
});

describe("DashboardLayout one-shot country prompt", () => {
  it("shows the prompt to a legacy account the server flags", () => {
    mockUser = { name: "Test", email: "t@t.com", role: "user" };
    mockPath = "/app";
    mockOnboarding = { completed: true, source: null, useCase: null, experience: null, country: null, needsCountry: true };
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).toContain("Country prompt shown");
    mockOnboarding = { completed: true, source: null, useCase: null, experience: null, country: null, needsCountry: false };
  });

  it("stays quiet once the prompt was answered or dismissed", () => {
    mockUser = { name: "Test", email: "t@t.com", role: "user" };
    mockPath = "/app";
    mockOnboarding = { completed: true, source: null, useCase: null, experience: null, country: "MX", needsCountry: false };
    const html = renderToStaticMarkup(<DashboardLayout><div>content</div></DashboardLayout>);
    expect(html).not.toContain("Country prompt shown");
    mockOnboarding = { completed: true, source: null, useCase: null, experience: null, country: null, needsCountry: false };
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
