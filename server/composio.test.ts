import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: {
    get composioApiKey() {
      return process.env.COMPOSIO_API_KEY ?? "";
    },
    composioApiUrl: "https://backend.composio.dev/api/v3.1",
  },
}));

import {
  ComposioApiError,
  composioUserId,
  createComposioConnectionLink,
  executeComposioTool,
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
      composioResponse({ items: [{ id: "acc_init", status: "INITIALIZING" }, { id: "acc_active", status: "ACTIVE" }] })
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
      .mockResolvedValueOnce(composioResponse({ items: [{ id: "acc_active", status: "ACTIVE" }] }))
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

  it("refuses to execute a tool when GitHub is not connected", async () => {
    const fetchImpl = vi.fn(async () => composioResponse({ items: [] }));
    await expect(executeComposioTool(2, "github", "GITHUB_STAR_A_REPOSITORY", { owner: "octocat" }, fetchImpl)).rejects.toThrow(
      "GitHub is not connected yet"
    );
  });

  it("executes a tool and surfaces failures from Composio", async () => {
    const successFetch = vi.fn()
      .mockResolvedValueOnce(composioResponse({ items: [{ id: "acc_active", status: "ACTIVE" }] }))
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
      .mockResolvedValueOnce(composioResponse({ items: [{ id: "acc_active", status: "ACTIVE" }] }))
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
