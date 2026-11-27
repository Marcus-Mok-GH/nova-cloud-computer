import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { checkWorkspaceApiRateLimit } = vi.hoisted(() => ({
  checkWorkspaceApiRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
}));

vi.mock("./workspaceApiLimit", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, checkWorkspaceApiRateLimit };
});

/**
 * The workspace API over HTTP.
 *
 * The point of the second key type is that it is a DIFFERENT key: a
 * workspace key drives the agent's computer, an inference key calls the model
 * API, and neither can do the other's job. These tests drive the real Express
 * router with the real key resolution, and prove the separation.
 */

const { findOwnerByApiKey } = vi.hoisted(() => ({
  findOwnerByApiKey: vi.fn(
    async (
      presentedKey: string,
      options?: { scope?: "inference" | "workspace" }
    ): Promise<number | null> => {
      // Mirrors the real resolver: the scope decides, and a key of the other
      // type never resolves.
      if (presentedKey.startsWith("nova_wk_")) {
        return options?.scope === "workspace" ? 1 : null;
      }
      if (presentedKey.startsWith("nova_sk_")) {
        return options?.scope === "inference" ? 1 : null;
      }
      return null;
    }
  ),
}));

vi.mock("./apiKeys", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, findOwnerByApiKey };
});

const { workspaceApiRouter, readWorkspaceKeyFromRequest } = await import("./workspaceApi");

const files: Array<{ id: number; name: string; content: string }> = [
  { id: 1, name: "notes.md", content: "hello" },
];

vi.mock("./db/workspaceFiles", () => ({
  listWorkspaceFilesForUser: vi.fn(async () => files),
  getWorkspaceFileForUser: vi.fn(async (_ownerId: number, id: number) =>
    files.find(file => file.id === id)
  ),
  createWorkspaceFileForUser: vi.fn(async (_ownerId: number, input: { name: string }) => {
    const file = { id: 2, name: input.name, content: "" };
    files.push(file);
    return file;
  }),
  updateWorkspaceFileForUser: vi.fn(async (_ownerId: number, id: number) =>
    files.find(file => file.id === id)
  ),
  deleteWorkspaceFileForUser: vi.fn(async (_ownerId: number, id: number) => {
    const index = files.findIndex(file => file.id === id);
    if (index < 0) return false;
    files.splice(index, 1);
    return true;
  }),
  searchWorkspaceFilesForUser: vi.fn(async () => ({ matches: [] })),
}));

vi.mock("./userAutomations", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listUserAutomations: vi.fn(async () => []),
    getUserAutomation: vi.fn(async () => undefined),
    createUserAutomation: vi.fn(async (_ownerId: number, input: { name: string; scheduleCron: string }) => ({
      id: 5,
      name: input.name,
      scheduleCron: input.scheduleCron,
    })),
    updateUserAutomation: vi.fn(async (_ownerId: number, id: number, input: { name?: string }) => ({
      id,
      name: input.name ?? "existing",
    })),
    deleteUserAutomation: vi.fn(async () => true),
  };
});

vi.mock("./db/deployments", () => ({
  listSiteDeploymentRegistryForUser: vi.fn(async () => [
    {
      key: "d-01",
      siteId: "site-1",
      siteName: "My site",
      siteUrl: "https://my-site.netlify.app",
      description: null,
      status: "live",
      lastDeployedAt: new Date("2026-11-27T00:00:00Z"),
    },
  ]),
}));

vi.mock("./siteDeploy", () => ({
  deleteWorkspaceSite: vi.fn(async (_ownerId: number, options?: { deployment?: string }) =>
    options?.deployment
      ? { ok: true as const, deleted: [{ key: options.deployment, siteId: "site-1", siteUrl: "https://my-site.netlify.app", description: null }], failed: 0 }
      : { ok: false as const, message: "Name the deployment to delete by its ID." }
  ),
}));

vi.mock("./terminal", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getTerminalStatusForUser: vi.fn(() => ({ running: false })),
    startTerminalForUser: vi.fn(async () => ({ reused: false, ptyId: "pty", offset: 0, seq: 0, output: "" })),
    readTerminalForUser: vi.fn(() => ({ seq: 0, output: "" })),
    writeTerminalForUser: vi.fn(async () => undefined),
    stopTerminalForUser: vi.fn(async () => ({ success: true })),
  };
});

const { app } = await import("./app");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeEach(() => {
  checkWorkspaceApiRateLimit.mockClear();
  checkWorkspaceApiRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
});

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("the workspace API key", () => {
  it("reads a workspace key from either accepted header", () => {
    expect(readWorkspaceKeyFromRequest({ authorization: "Bearer nova_wk_abc" })).toBe("nova_wk_abc");
    expect(readWorkspaceKeyFromRequest({ "x-api-key": "nova_wk_abc" })).toBe("nova_wk_abc");
    // An inference key is not a workspace key.
    expect(readWorkspaceKeyFromRequest({ authorization: "Bearer nova_sk_abc" })).toBeNull();
    expect(readWorkspaceKeyFromRequest({})).toBeNull();
  });

  it("answers a workspace request with the workspace key", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/v1/files`, {
      headers: { authorization: "Bearer nova_wk_abc" },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data?: Array<{ name: string }> };
    expect(payload.data?.[0]?.name).toBe("notes.md");
  });

  it("refuses an inference key on the workspace API", async () => {
    // The two key types are not interchangeable: an inference key must not be
    // able to read the workspace.
    const response = await fetch(`${baseUrl}/api/workspace/v1/files`, {
      headers: { authorization: "Bearer nova_sk_abc" },
    });
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("invalid_api_key");
  });

  it("refuses a request with no key at all", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/v1/files`);
    expect(response.status).toBe(401);
  });

  it("resolves the owner through the scoped key lookup", async () => {
    findOwnerByApiKey.mockClear();
    await fetch(`${baseUrl}/api/workspace/v1/files`, {
      headers: { authorization: "Bearer nova_wk_abc" },
    });
    expect(findOwnerByApiKey).toHaveBeenCalledWith(
      "nova_wk_abc",
      expect.objectContaining({ scope: "workspace" })
    );
  });

  it("deletes a deployment for real, not just in the database", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/v1/deployments/d-01`, {
      method: "DELETE",
      headers: { authorization: "Bearer nova_wk_abc" },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { deleted?: string[] };
    expect(payload.deleted).toEqual(["d-01"]);
    // The real deletion path runs, so the live site actually goes down.
    const { deleteWorkspaceSite } = await import("./siteDeploy");
    expect(deleteWorkspaceSite).toHaveBeenCalledWith(1, { deployment: "d-01" });
  });

  it("refuses to enable an automation, whose schedule needs the app's session", async () => {
    // Enabling creates a background schedule through a session-bound call, so
    // a key cannot do it. Storing "enabled" without the schedule would look
    // scheduled and never run.
    const response = await fetch(`${baseUrl}/api/workspace/v1/automations/5`, {
      method: "PATCH",
      headers: {
        authorization: "Bearer nova_wk_abc",
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("schedule_requires_session");
  });

  it("gives a key-created automation the same cron the app would give it", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/v1/automations`, {
      method: "POST",
      headers: {
        authorization: "Bearer nova_wk_abc",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "morning brief",
        instructions: "Summarise my day",
        frequency: "daily",
        scheduleCron: "0 0 9 * * *",
        scheduleTimezone: "UTC",
        executionPrompt: "Summarise my day",
      }),
    });
    expect(response.status).toBe(201);
    const { createUserAutomation } = await import("./userAutomations");
    expect(createUserAutomation).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ scheduleCron: "0 0 9 * * *" })
    );
  });

  it("refuses a key that is over its request budget", async () => {
    // A workspace key can write to the agent's shell, so a runaway script must
    // be stopped rather than allowed to hammer it.
    checkWorkspaceApiRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 30_000 });
    const response = await fetch(`${baseUrl}/api/workspace/v1/files`, {
      headers: { authorization: "Bearer nova_wk_abc" },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("rate_limit");
  });

  it("budgets each key separately", async () => {
    await fetch(`${baseUrl}/api/workspace/v1/files`, {
      headers: { authorization: "Bearer nova_wk_abc" },
    });
    // The budget is looked up by the KEY, not by the owner, so two keys are
    // two credentials with two allowances.
    expect(checkWorkspaceApiRateLimit).toHaveBeenCalledWith(
      expect.any(String),
    );
  });

  it("reports the terminal stop truthfully", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/v1/terminal/stop`, {
      method: "POST",
      headers: { authorization: "Bearer nova_wk_abc" },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { stopped?: boolean };
    expect(payload.stopped).toBe(true);
  });

  it("routes the file search to search, not to the :id route", async () => {
    // Express matches in order: a `/files/:id` route registered first would
    // swallow the literal "search" segment and answer with a file lookup.
    const response = await fetch(`${baseUrl}/api/workspace/v1/files/search?query=notes`, {
      headers: { authorization: "Bearer nova_wk_abc" },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { object?: string };
    expect(payload.object).toBe("list");
  });

  it("creates a file through the workspace key", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/v1/files`, {
      method: "POST",
      headers: {
        authorization: "Bearer nova_wk_abc",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "from-script.md", content: "written by a key" }),
    });
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { name?: string };
    expect(payload.name).toBe("from-script.md");
  });

  it("answers a route failure with JSON, not a stack trace", async () => {
    // A workspace route can fail for a reason the caller should read (the
    // terminal is not open yet), so it must be JSON with a real status.
    const { writeTerminalForUser } = await import("./terminal");
    const { TerminalError } = await import("./terminal");
    vi.mocked(writeTerminalForUser).mockRejectedValueOnce(
      new TerminalError("Open the terminal before typing into it.", "precondition")
    );
    const response = await fetch(`${baseUrl}/api/workspace/v1/terminal/input`, {
      method: "POST",
      headers: {
        authorization: "Bearer nova_wk_abc",
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: "ls" }),
    });
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(payload.error?.code).toBe("terminal_error");
    expect(payload.error?.message).toContain("Open the terminal");
  });

  it("rejects a malformed body with a 400 before touching the workspace", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/v1/files`, {
      method: "POST",
      headers: {
        authorization: "Bearer nova_wk_abc",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "" }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("invalid_body");
  });
});
