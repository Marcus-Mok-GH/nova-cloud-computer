import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Admin from "./Admin";

let authState: { loading: boolean; user: { id: number; role: "user" | "admin" } | null };

vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {} }, innerWidth: 1200, addEventListener: () => {} });

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn(), switchable: true }) }));
vi.mock("./NotFound", () => ({ default: () => <div>404</div> }));
vi.mock("wouter", () => ({ useLocation: () => ["/app/admin", vi.fn()], useSearch: () => "", Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ admin: { overview: { invalidate: vi.fn() }, users: { invalidate: vi.fn() } } }),
    admin: {
      overview: { useQuery: () => ({ data: { totals: { users: 2, admins: 1, chats: 3, messages: 12, projects: 1, tasks: 4, automations: 0, workspaces: 2, telegramLinked: 1, activeAgentRuns: 0 }, recentUsers: [], recentAgentRuns: [] }, isLoading: false }) },
      users: { useQuery: () => ({ data: [
        { id: 1, name: "Owner", email: "owner@example.com", role: "admin", createdAt: new Date("2026-09-01"), lastSignedIn: new Date("2026-09-15") },
        { id: 2, name: "Helper", email: "helper@example.com", role: "user", createdAt: new Date("2026-09-10"), lastSignedIn: new Date("2026-09-14") },
      ], isLoading: false }) },
      setUserRole: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

function setAuth(user: { id: number; role: "user" | "admin" } | null) {
  authState = { loading: false, user };
}

describe("Admin console page", () => {
  it("renders the overview and account list for an admin", () => {
    setAuth({ id: 1, role: "admin" });
    const markup = renderToStaticMarkup(<Admin />);
    expect(markup).toContain("Admin console");
    expect(markup).toContain("owner@example.com");
    expect(markup).toContain("helper@example.com");
    expect(markup).toContain("Promote");
  });

  it("hides the console behind the 404 page for non-admins and signed-out visitors", () => {
    setAuth({ id: 2, role: "user" });
    expect(renderToStaticMarkup(<Admin />)).toContain("404");
    setAuth(null);
    expect(renderToStaticMarkup(<Admin />)).toContain("404");
  });
});
