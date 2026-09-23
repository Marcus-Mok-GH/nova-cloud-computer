import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: {
    get composioApiKey() {
      return process.env.COMPOSIO_API_KEY ?? "";
    },
    composioApiUrl: "https://backend.composio.dev",
  },
}));

import {
  ComposioApiError,
  GITHUB_OPERATIONS,
  composioUserId,
  createComposioConnectionLink,
  deleteComposioConnection,
  executeComposioTool,
  executeGithubOperation,
  githubOperationRequest,
  getComposioConnectionStatus,
  listComposioTools,
} from "./composio";

function composioResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Composio connector client", () => {
  beforeEach(() => {
    process.env.COMPOSIO_API_KEY = "test-composio-key";
  });

  it("derives a stable Composio user id per workspace owner", () => {
    expect(composioUserId(7)).toBe("nova-user-7");
  });

  it("reports disconnected when the API key is absent, without calling Composio", async () => {
    process.env.COMPOSIO_API_KEY = "";
    const fetchImpl = vi.fn();
    await expect(getComposioConnectionStatus(1, "github", fetchImpl)).resolves.toEqual({
      configured: false,
      connected: false,
      status: "disconnected",
      connectedAccountId: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("detects an active GitHub connected account", async () => {
    const fetchImpl = vi.fn(async () =>
      composioResponse({ items: [{ id: "acc_init", user_id: "nova-user-3", status: "INITIALIZING" }, { id: "acc_active", user_id: "nova-user-3", status: "ACTIVE" }] })
    );
    await expect(getComposioConnectionStatus(3, "github", fetchImpl)).resolves.toEqual({
      configured: true,
      connected: true,
      status: "active",
      connectedAccountId: "acc_active",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/connected_accounts?user_id=nova-user-3&toolkit_slug=github"),
      expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "test-composio-key" }) })
    );
  });

  it("ignores another user's active account when the API returns project-wide accounts", async () => {
    // The live Composio list endpoint ignores the user_id query param and
    // returns accounts for every user in the project; status must stay
    // scoped to the requesting owner via the user_id field on each item.
    const fetchImpl = vi.fn(async () =>
      composioResponse({
        items: [
          { id: "acc_other", user_id: "nova-user-9", status: "ACTIVE" },
          { id: "acc_mine_dead", user_id: "nova-user-4", status: "INITIATED" },
        ],
      })
    );
    await expect(getComposioConnectionStatus(4, "github", fetchImpl)).resolves.toEqual({
      configured: true,
      connected: false,
      status: "disconnected",
      connectedAccountId: null,
    });
  });

  it("does not report Gmail connected when only GitHub is active under the same user", async () => {
    // The endpoint also ignores toolkit_slug, so a GitHub connection under the
    // requesting user must not light up the Gmail card.
    const fetchImpl = vi.fn(async () =>
      composioResponse({
        items: [
          { id: "acc_github", user_id: "nova-user-4", status: "ACTIVE", toolkit: { slug: "github" } },
          { id: "acc_gmail_dead", user_id: "nova-user-4", status: "INITIATED", toolkit: { slug: "gmail" } },
        ],
      })
    );
    await expect(getComposioConnectionStatus(4, "gmail", fetchImpl)).resolves.toEqual({
      configured: true,
      connected: false,
      status: "disconnected",
      connectedAccountId: null,
    });
  });

  it("reports Gmail connected when the user's own Gmail account is active", async () => {
    const fetchImpl = vi.fn(async () =>
      composioResponse({
        items: [{ id: "acc_gmail", user_id: "nova-user-4", status: "ACTIVE", toolkit: { slug: "gmail" } }],
      })
    );
    await expect(getComposioConnectionStatus(4, "gmail", fetchImpl)).resolves.toEqual({
      configured: true,
      connected: true,
      status: "active",
      connectedAccountId: "acc_gmail",
    });
  });

  it("matches toolkit scoping for legacy payloads that omit the toolkit field", async () => {
    const fetchImpl = vi.fn(async () =>
      composioResponse({ items: [{ id: "acc_active", user_id: "nova-user-4", status: "ACTIVE" }] })
    );
    await expect(getComposioConnectionStatus(4, "gmail", fetchImpl)).resolves.toEqual({
      configured: true,
      connected: true,
      status: "active",
      connectedAccountId: "acc_active",
    });
  });

  it("deletes the user's active connected account and returns the refreshed status", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const url = String(_url);
      const calledWith = (path: string) => url.includes(path);
      const body = (() => {
        try {
          return init?.body ? JSON.parse(String(init.body)) : undefined;
        } catch {
          return undefined;
        }
      })();
      if (calledWith("/connected_accounts/") && init?.method === "DELETE")
        return composioResponse({ success: true });
      if (calledWith("/connected_accounts/link")) return composioResponse({ redirect_url: "https://example.com/link" });
      // List endpoint: one active account until the DELETE lands, none after.
      const deleted = fetchImpl.mock.calls.some(call => {
        const [u, i] = call as [string, RequestInit | undefined];
        return String(u).includes("/connected_accounts/") && i?.method === "DELETE";
      });
      return composioResponse({
        items: deleted
          ? []
          : [{ id: "acc_gmail", user_id: "nova-user-8", status: "ACTIVE", toolkit: { slug: "gmail" } }],
      });
    });
    const after = await deleteComposioConnection(8, "gmail", fetchImpl);
    expect(after).toEqual({ configured: true, connected: false, status: "disconnected", connectedAccountId: null });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/connected_accounts/acc_gmail"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("refuses to disconnect when the toolkit is not connected", async () => {
    const fetchImpl = vi.fn(async () => composioResponse({ items: [] }));
    await expect(deleteComposioConnection(8, "gmail", fetchImpl)).rejects.toThrow("Gmail is not connected");
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining("/connected_accounts/acc"), expect.anything());
  });

  it("creates a connection link through the Composio-managed GitHub auth config", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(composioResponse({ items: [{ id: "acfg_github" }] }))
      .mockResolvedValueOnce(composioResponse({ redirect_url: "https://composio.dev/link/abc", connected_account_id: "acc_new" }));
    await expect(createComposioConnectionLink(5, "github", { callbackUrl: "https://nova.example.com/app/settings?connected=github" }, fetchImpl)).resolves.toEqual({
      redirectUrl: "https://composio.dev/link/abc",
      connectedAccountId: "acc_new",
    });
    const linkCall = fetchImpl.mock.calls[1];
    expect(linkCall[0]).toContain("/connected_accounts/link");
    expect(JSON.parse(String(linkCall[1].body))).toEqual({
      auth_config_id: "acfg_github",
      user_id: "nova-user-5",
      callback_url: "https://nova.example.com/app/settings?connected=github",
    });
  });

  it("fails clearly when no GitHub auth config exists in the project", async () => {
    const fetchImpl = vi.fn(async () => composioResponse({ items: [] }));
    await expect(createComposioConnectionLink(1, "github", {}, fetchImpl)).rejects.toThrow(ComposioApiError);
  });

  it("lists tool slugs with parameter schemas after confirming the connection", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(composioResponse({ items: [{ id: "acc_active", user_id: "nova-user-9", status: "ACTIVE" }] }))
      .mockResolvedValueOnce(
        composioResponse({
          items: [
            {
              slug: "GITHUB_CREATE_AN_ISSUE",
              name: "Create issue",
              human_description: "Create a new issue in a repository",
              input_parameters: { repo_name: { type: "string", description: "owner/repo", required: true } },
            },
          ],
        })
      );
    await expect(listComposioTools(9, "github", { search: "create issue" }, fetchImpl)).resolves.toEqual({
      tools: [
        {
          slug: "GITHUB_CREATE_AN_ISSUE",
          name: "Create issue",
          description: "Create a new issue in a repository",
          inputParameters: { repo_name: { type: "string", description: "owner/repo", required: true } },
        },
      ],
    });
    expect(fetchImpl.mock.calls[1][0]).toContain("/tools?toolkit_slug=github&limit=25&query=create+issue");
  });

  it("maps a simple owner/repo file read to the stable GitHub action", () => {
    expect(githubOperationRequest("read_file", {
      repo: "octocat/Hello-World",
      path: "README.md",
      ref: "main",
    })).toEqual({
      action: "GITHUB_GET_REPOSITORY_CONTENT",
      args: {
        owner: "octocat",
        repo: "Hello-World",
        path: "README.md",
        ref: "main",
      },
    });
  });

  it("uses repository search instead of GitHub App installation actions", () => {
    expect(githubOperationRequest("search_repositories", {})).toEqual({
      action: "GITHUB_FIND_REPOSITORIES",
      args: {
        query: "*",
        per_page: 25,
        response_detail: "minimal",
        for_authenticated_user: true,
      },
    });
    expect(githubOperationRequest("search_repositories", { query: "nova" })).toEqual({
      action: "GITHUB_FIND_REPOSITORIES",
      args: {
        query: "nova",
        per_page: 25,
        response_detail: "minimal",
        for_authenticated_user: true,
      },
    });
    expect(githubOperationRequest("search_repositories", { query: "react", scope: "public" })).toEqual({
      action: "GITHUB_FIND_REPOSITORIES",
      args: {
        query: "react",
        per_page: 25,
        response_detail: "minimal",
      },
    });
    expect(() => githubOperationRequest("search_repositories", { scope: "other" })).toThrow(
      'scope must be "mine" or "public"'
    );
    expect(GITHUB_OPERATIONS).toEqual(expect.not.arrayContaining(["list_accessible_repositories", "list_app_installations"]));
  });

  it("normalizes issue creation and executes only the selected stable action", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(composioResponse({ items: [{ id: "acc_active", user_id: "nova-user-12", status: "ACTIVE", toolkit: { slug: "github" } }] }))
      .mockResolvedValueOnce(composioResponse({ data: { number: 42 }, successful: true }));

    await expect(executeGithubOperation(12, "create_issue", {
      repo: "octocat/Hello-World",
      title: "Make connector simpler",
      body: "Use the stable GitHub interface.",
      labels: ["enhancement"],
    }, fetchImpl)).resolves.toEqual({
      ok: true,
      data: { number: 42 },
      error: null,
    });

    expect(fetchImpl.mock.calls[1][0]).toContain("/tools/execute/GITHUB_CREATE_AN_ISSUE");
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1].body))).toEqual({
      user_id: "nova-user-12",
      arguments: {
        owner: "octocat",
        repo: "Hello-World",
        title: "Make connector simpler",
        body: "Use the stable GitHub interface.",
        labels: ["enhancement"],
      },
    });
  });

  it("preserves write_file content exactly, including whitespace and emptiness", () => {
    expect(githubOperationRequest("write_file", {
      repo: "octocat/Hello-World",
      path: "src/example.ts",
      content: "\n  export const value = 1;\n",
      message: "Keep formatting",
    })).toEqual({
      action: "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
      args: {
        owner: "octocat",
        repo: "Hello-World",
        path: "src/example.ts",
        content: "\n  export const value = 1;\n",
        message: "Keep formatting",
      },
    });
    expect(githubOperationRequest("write_file", {
      repo: "octocat/Hello-World",
      path: "empty.txt",
      content: "",
      message: "Create empty file",
    }).args.content).toBe("");
  });

  it("rejects ambiguous repository names before making a connector call", async () => {
    const fetchImpl = vi.fn();
    await expect(executeGithubOperation(12, "get_repository", { repo: "Hello-World" }, fetchImpl)).rejects.toThrow(
      'repo must use the owner/name format'
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to execute a tool when GitHub is not connected", async () => {
    const fetchImpl = vi.fn(async () => composioResponse({ items: [] }));
    await expect(executeComposioTool(2, "github", "GITHUB_STAR_A_REPOSITORY", { owner: "octocat" }, fetchImpl)).rejects.toThrow(
      "GitHub is not connected yet"
    );
  });

  it("executes a tool and surfaces failures from Composio", async () => {
    const successFetch = vi.fn()
      .mockResolvedValueOnce(composioResponse({ items: [{ id: "acc_active", user_id: "nova-user-4", status: "ACTIVE" }] }))
      .mockResolvedValueOnce(composioResponse({ data: { starred: true }, successful: true }));
    await expect(executeComposioTool(4, "github", "GITHUB_STAR_A_REPOSITORY", { owner: "octocat", repo: "Hello-World" }, successFetch)).resolves.toEqual({
      ok: true,
      data: { starred: true },
      error: null,
    });
    expect(successFetch.mock.calls[1][0]).toContain("/tools/execute/GITHUB_STAR_A_REPOSITORY");
    expect(JSON.parse(String(successFetch.mock.calls[1][1].body))).toEqual({
      user_id: "nova-user-4",
      arguments: { owner: "octocat", repo: "Hello-World" },
    });

    const failureFetch = vi.fn()
      .mockResolvedValueOnce(composioResponse({ items: [{ id: "acc_active", user_id: "nova-user-4", status: "ACTIVE" }] }))
      .mockResolvedValueOnce(composioResponse({ data: null, successful: false, error: "repo not found" }));
    await expect(executeComposioTool(4, "github", "GITHUB_STAR_A_REPOSITORY", {}, failureFetch)).resolves.toEqual({
      ok: false,
      data: null,
      error: "repo not found",
    });
  });

  it("supports the Gmail toolkit with its own connection state and messages", async () => {
    const fetchImpl = vi.fn(async () => composioResponse({ items: [] }));
    await expect(getComposioConnectionStatus(6, "gmail", fetchImpl)).resolves.toEqual({
      configured: true,
      connected: false,
      status: "disconnected",
      connectedAccountId: null,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/connected_accounts?user_id=nova-user-6&toolkit_slug=gmail"),
      expect.anything()
    );
    await expect(executeComposioTool(6, "gmail", "GMAIL_SEND_EMAIL", { to: "a@b.co" }, fetchImpl)).rejects.toThrow(
      "Gmail is not connected yet"
    );
  });

  it("wraps Composio HTTP errors with their message", async () => {
    const fetchImpl = vi.fn(async () => composioResponse({ error: { message: "Invalid API key" } }, 401));
    await expect(getComposioConnectionStatus(1, fetchImpl)).rejects.toThrow("Invalid API key");
  });
});
