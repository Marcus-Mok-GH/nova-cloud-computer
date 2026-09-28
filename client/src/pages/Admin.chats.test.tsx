import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Admin, { AdminUserContent } from "./Admin";

let authState: {
  loading: boolean;
  user: { id: number; role: "user" | "admin" } | null;
};
vi.stubGlobal("window", {
  localStorage: { getItem: () => null, setItem: () => {} },
  innerWidth: 1200,
  addEventListener: () => {},
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState }));
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn(), switchable: true }),
}));
vi.mock("./NotFound", () => ({ default: () => <div>404</div> }));
vi.mock("wouter", () => ({
  useLocation: () => ["/app/admin", vi.fn()],
  useSearch: () => "",
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      setUsername: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
    },
    credits: {
      status: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    useUtils: () => ({
      admin: {
        overview: { invalidate: vi.fn() },
        users: { invalidate: vi.fn() },
      },
    }),
    admin: {
      overview: {
        useQuery: () => ({
          data: {
            totals: {
              users: 1,
              admins: 1,
              chats: 1,
              messages: 3,
              projects: 0,
              tasks: 0,
              automations: 0,
              workspaces: 1,
              telegramLinked: 0,
              activeAgentRuns: 0,
            },
            recentUsers: [],
            recentAgentRuns: [],
          },
          isLoading: false,
        }),
      },
      users: {
        useQuery: () => ({
          data: [
            {
              id: 2,
              name: "U",
              email: "u@example.com",
              role: "user",
              bannedAt: null,
              createdAt: new Date(),
              lastSignedIn: new Date(),
            },
          ],
          isLoading: false,
        }),
      },
      setUserRole: { useMutation: () => ({ mutate: vi.fn() }) },
      setUserBanned: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteUser: { useMutation: () => ({ mutate: vi.fn() }) },
      userChats: {
        useQuery: () => ({
          data: [
            {
              id: 1,
              title: "Deploy check",
              createdAt: new Date("2026-09-27T10:00:00Z"),
              updatedAt: new Date("2026-09-27T11:00:00Z"),
              messages: [
                {
                  id: 1,
                  role: "user",
                  content: "Can you deploy my site?",
                  createdAt: new Date("2026-09-27T10:00:00Z"),
                },
                {
                  id: 2,
                  role: "assistant",
                  content:
                    "__nova_tool_activity__:" +
                    JSON.stringify({
                      id: "t1",
                      name: "deploy_website",
                      state: "completed",
                      args: { url: "https://x.dev" },
                      summary: "Deployed x.dev",
                    }),
                  createdAt: new Date("2026-09-27T10:05:00Z"),
                },
                {
                  id: 3,
                  role: "assistant",
                  content: '__nova_specialist_acceptance__:{"whatever":1}',
                  createdAt: new Date("2026-09-27T10:06:00Z"),
                },
                {
                  id: 4,
                  role: "assistant",
                  content:
                    "Done. **Deployed** to:\n- https://x.dev\n\n```js\nconsole.log(1)\n```",
                  createdAt: new Date("2026-09-27T10:07:00Z"),
                },
              ],
            },
          ],
          isLoading: false,
        }),
      },
      userFiles: { useQuery: () => ({ data: [], isLoading: false }) },
      userFileContent: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

describe("Admin chat log readability smoke", () => {
  it("renders bubbles, markdown, tool chips, and hides internal rows", () => {
    authState = { loading: false, user: { id: 1, role: "admin" } };
    const markup = renderToStaticMarkup(<AdminUserContent userId={2} />);
    expect(markup).toContain("3 messages"); // specialist row excluded from the count
    expect(markup).toContain("justify-end"); // user bubble aligned right
    expect(markup).toContain("deploy_website"); // tool chip, not raw JSON
    expect(markup).not.toContain("__nova_specialist_acceptance__"); // internal row hidden
    expect(markup).not.toContain("__nova_tool_activity__"); // no raw JSON blob
    expect(markup).toContain("<strong");
    expect(markup).toContain("Deployed"); // markdown rendered
    expect(markup).toContain("Can you deploy my site?"); // user text present
  });
});
