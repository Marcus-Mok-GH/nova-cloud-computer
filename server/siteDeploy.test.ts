import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  isNetlifyConfigured: vi.fn(() => true),
  createNetlifySite: vi.fn(async () => ({ id: "site-new", name: "nova-fresh-site", url: "https://nova-fresh-site.netlify.app" })),
  deployFilesToNetlifySite: vi.fn(async () => ({ deployId: "dep-new" })),
  deleteNetlifySite: vi.fn(async () => undefined),
  listSiteDeploymentsForUser: vi.fn(async () => []),
  getLatestSiteDeploymentForUser: vi.fn(async () => null),
  listSiteDeploymentRegistryForUser: vi.fn(async () => []),
  getSiteDeploymentByKeyForUser: vi.fn(async () => null),
  nextSiteDeploymentKeyForUser: vi.fn(async () => "d-01"),
  updateSiteDeploymentDescriptionForUser: vi.fn(async () => 1),
  markSiteDeploymentsDeletedForUser: vi.fn(async () => 1),
  listWorkspaceFilesForUser: vi.fn(async () => []),
  listWorkspaceFoldersForUser: vi.fn(async () => []),
  recordSiteDeployment: vi.fn(async (_owner: number, input: { siteId: string; deploymentKey?: string; description?: string | null }) => ({
    id: 31, siteId: input.siteId, siteName: "nova-fresh-site", siteUrl: "https://nova-fresh-site.netlify.app",
    deploymentKey: input.deploymentKey ?? null, description: input.description ?? null,
    status: "deploying", fileCount: 0, error: null, createdAt: new Date("2026-09-16T12:00:00.000Z"), updatedAt: new Date(),
  })),
  updateSiteDeploymentStatusForUser: vi.fn(async (_owner: number, id: number, status: "live" | "failed", error?: string) => ({
    id, status, error: error ?? null, siteId: "site-new", siteName: "nova-fresh-site", siteUrl: "https://nova-fresh-site.netlify.app",
    deploymentKey: "d-01", description: "test site", fileCount: 2,
    createdAt: new Date("2026-09-16T12:00:00.000Z"), updatedAt: new Date(),
  })),
}));

vi.mock("./db", () => ({
  getLatestSiteDeploymentForUser: spies.getLatestSiteDeploymentForUser,
  listSiteDeploymentsForUser: spies.listSiteDeploymentsForUser,
  listSiteDeploymentRegistryForUser: spies.listSiteDeploymentRegistryForUser,
  getSiteDeploymentByKeyForUser: spies.getSiteDeploymentByKeyForUser,
  nextSiteDeploymentKeyForUser: spies.nextSiteDeploymentKeyForUser,
  updateSiteDeploymentDescriptionForUser: spies.updateSiteDeploymentDescriptionForUser,
  markSiteDeploymentsDeletedForUser: spies.markSiteDeploymentsDeletedForUser,
  listWorkspaceFilesForUser: spies.listWorkspaceFilesForUser,
  listWorkspaceFoldersForUser: spies.listWorkspaceFoldersForUser,
  recordSiteDeployment: spies.recordSiteDeployment,
  updateSiteDeploymentStatusForUser: spies.updateSiteDeploymentStatusForUser,
}));
vi.mock("./netlify", () => ({
  isNetlifyConfigured: spies.isNetlifyConfigured,
  createNetlifySite: spies.createNetlifySite,
  deployFilesToNetlifySite: spies.deployFilesToNetlifySite,
  deleteNetlifySite: spies.deleteNetlifySite,
}));

const { deleteWorkspaceSite, deployWorkspaceSite, describeDeploymentsForUser, getDeploymentStatusForUser } = await import("./siteDeploy");

const indexFile = { id: 1, folderId: null, name: "index.html", content: "<html>hi</html>" };
const nestedFile = { id: 2, folderId: 5, name: "about.html", content: "about" };
const folders = [{ id: 5, parentId: null, name: "site" }];

const registryEntry = (overrides: Record<string, unknown> = {}) => ({
  key: "d-01",
  siteId: "site-old",
  siteName: "nova-old-site",
  siteUrl: "https://nova-old-site.netlify.app",
  description: "portfolio site",
  status: "live",
  lastDeployedAt: new Date("2026-09-19T10:00:00.000Z"),
  ...overrides,
});

describe("Workspace website deployer", () => {
  afterEach(() => {
    vi.clearAllMocks();
    spies.isNetlifyConfigured.mockImplementation(() => true);
    spies.getLatestSiteDeploymentForUser.mockResolvedValue(null);
    spies.getSiteDeploymentByKeyForUser.mockResolvedValue(null);
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([]);
    spies.nextSiteDeploymentKeyForUser.mockResolvedValue("d-01");
    spies.deployFilesToNetlifySite.mockResolvedValue({ deployId: "dep-new" });
  });

  it("refuses to deploy when Netlify is not configured", async () => {
    spies.isNetlifyConfigured.mockImplementation(() => false);
    const result = await deployWorkspaceSite(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("NETLIFY_API_TOKEN");
    expect(spies.deployFilesToNetlifySite).not.toHaveBeenCalled();
  });

  it("requires an index.html entry page before deploying", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([{ id: 2, folderId: null, name: "notes.md", content: "hello" }]);
    const result = await deployWorkspaceSite(1, null, { description: "test site" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("index.html");
    expect(spies.createNetlifySite).not.toHaveBeenCalled();
  });

  it("requires a description on every deploy - even without any deployment ID", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    const result = await deployWorkspaceSite(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("required on every deploy");
      expect(result.message).not.toContain("index.html");
    }
    expect(spies.createNetlifySite).not.toHaveBeenCalled();
    expect(spies.recordSiteDeployment).not.toHaveBeenCalled();
  });

  it("refuses a redeploy that arrives without a description", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.getSiteDeploymentByKeyForUser.mockResolvedValue(registryEntry());

    const result = await deployWorkspaceSite(1, null, { deployment: "d-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("required on every deploy");
    expect(spies.deployFilesToNetlifySite).not.toHaveBeenCalled();
    expect(spies.recordSiteDeployment).not.toHaveBeenCalled();
  });

  it("creates a new deployment with its own key and description on first deploy", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile, nestedFile]);
    spies.listWorkspaceFoldersForUser.mockResolvedValue(folders);
    spies.nextSiteDeploymentKeyForUser.mockResolvedValue("d-03");

    const result = await deployWorkspaceSite(1, null, { description: "bakery landing page" });
    expect(result.ok).toBe(true);
    expect(spies.createNetlifySite).toHaveBeenCalledTimes(1);
    const [siteId, files] = spies.deployFilesToNetlifySite.mock.calls[0];
    expect(siteId).toBe("site-new");
    expect(files.map((file: { path: string }) => file.path)).toEqual(["/index.html", "/site/about.html"]);
    expect(files[0].content.toString()).toBe("<html>hi</html>");
    const [owner, record] = spies.recordSiteDeployment.mock.calls[0];
    expect(owner).toBe(1);
    expect(record).toMatchObject({
      siteId: "site-new",
      deploymentKey: "d-03",
      description: "bakery landing page",
      fileCount: 2,
      status: "deploying",
    });
    expect(spies.updateSiteDeploymentStatusForUser).toHaveBeenCalledWith(1, 31, "live");
  });

  it("publishes to an existing deployment by its ID, keeping the URL stable", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.getSiteDeploymentByKeyForUser.mockResolvedValue(registryEntry());

    const result = await deployWorkspaceSite(1, null, { deployment: "d-01", description: "portfolio site" });
    expect(result.ok).toBe(true);
    expect(spies.createNetlifySite).not.toHaveBeenCalled();
    expect(spies.deployFilesToNetlifySite).toHaveBeenCalledWith("site-old", expect.anything());
    expect(spies.recordSiteDeployment.mock.calls[0][1]).toMatchObject({
      siteId: "site-old",
      siteUrl: "https://nova-old-site.netlify.app",
      deploymentKey: "d-01",
      description: "portfolio site",
    });
    expect(spies.updateSiteDeploymentDescriptionForUser).not.toHaveBeenCalled();
    expect(spies.nextSiteDeploymentKeyForUser).not.toHaveBeenCalled();
  });

  it("never implicitly targets the latest deployment: no ID always creates a new one", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.getLatestSiteDeploymentForUser.mockResolvedValue({
      id: 30, siteId: "site-old", siteName: "nova-old-site", siteUrl: "https://nova-old-site.netlify.app",
      status: "live", fileCount: 2, error: null, createdAt: new Date(), updatedAt: new Date(),
    });
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([registryEntry()]);

    const result = await deployWorkspaceSite(1, null, { description: "a second, separate project" });
    expect(result.ok).toBe(true);
    expect(spies.createNetlifySite).toHaveBeenCalledTimes(1);
    expect(spies.deployFilesToNetlifySite).toHaveBeenCalledWith("site-new", expect.anything());
    expect(spies.recordSiteDeployment.mock.calls[0][1]).toMatchObject({
      siteId: "site-new",
      deploymentKey: "d-01",
      description: "a second, separate project",
    });
  });

  it("refuses an unknown deployment ID and lists the known deployments", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.getSiteDeploymentByKeyForUser.mockResolvedValue(null);
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([registryEntry()]);

    const result = await deployWorkspaceSite(1, null, { deployment: "d-99", description: "test site" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("no deployment 'd-99'");
      expect(result.message).toContain("d-01");
    }
    expect(spies.createNetlifySite).not.toHaveBeenCalled();
    expect(spies.recordSiteDeployment).not.toHaveBeenCalled();
  });

  it("refuses to publish to a deleted deployment", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.getSiteDeploymentByKeyForUser.mockResolvedValue(registryEntry({ status: "deleted" }));

    const result = await deployWorkspaceSite(1, null, { deployment: "d-01", description: "test site" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("deleted");
    expect(spies.deployFilesToNetlifySite).not.toHaveBeenCalled();
  });

  it("updates the description when a redeploy passes a new one", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.getSiteDeploymentByKeyForUser.mockResolvedValue(registryEntry({ description: "old description" }));

    const result = await deployWorkspaceSite(1, null, { deployment: "d-01", description: "new description" });
    expect(result.ok).toBe(true);
    expect(spies.updateSiteDeploymentDescriptionForUser).toHaveBeenCalledWith(1, "d-01", "new description");
    expect(spies.recordSiteDeployment.mock.calls[0][1]).toMatchObject({ description: "new description" });
  });

  it("decodes binary data-URI files into their real bytes", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([
      indexFile,
      { id: 2, folderId: null, name: "logo.png", content: "data:image/png;base64,aGVsbG8=" },
    ]);
    const result = await deployWorkspaceSite(1, null, { description: "test site" });
    expect(result.ok).toBe(true);
    const files = spies.deployFilesToNetlifySite.mock.calls[0][1];
    const logo = files.find((file: { path: string }) => file.path === "/logo.png");
    expect(logo.content.toString("utf8")).toBe("hello");
  });

  it("records the failure when Netlify rejects the deployment", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.deployFilesToNetlifySite.mockRejectedValue(new Error("status 429: slow down"));

    const result = await deployWorkspaceSite(1, null, { description: "test site" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("status 429");
    expect(spies.updateSiteDeploymentStatusForUser).toHaveBeenCalledWith(1, 31, "failed", "status 429: slow down");
  });

  it("deploys a chosen directory, re-rooting its paths and ignoring everything outside it", async () => {
    const projectFolder = { id: 9, parentId: null, name: "my-react-app" };
    const srcFolder = { id: 10, parentId: 9, name: "src" };
    spies.listWorkspaceFilesForUser.mockResolvedValue([
      indexFile, // workspace root - must NOT be part of this deploy
      { id: 3, folderId: 9, name: "index.html", content: "<html>app</html>" },
      { id: 4, folderId: 10, name: "styles.css", content: "body{}" },
      { id: 5, folderId: 10, name: "main.jsx", content: "export {}" },
    ]);
    spies.listWorkspaceFoldersForUser.mockResolvedValue([folders[0], projectFolder, srcFolder]);

    const result = await deployWorkspaceSite(1, "my-react-app", { description: "test site" });
    expect(result.ok).toBe(true);
    const [siteId, files] = spies.deployFilesToNetlifySite.mock.calls[0];
    expect(siteId).toBe("site-new");
    expect(files.map((file: { path: string }) => file.path).sort()).toEqual(
      ["/index.html", "/src/styles.css", "/src/main.jsx"].sort()
    );
    const [owner, record] = spies.recordSiteDeployment.mock.calls[0];
    expect(record).toMatchObject({ fileCount: 3, status: "deploying" });
  });

  it("matches the chosen directory case-insensitively and tolerates surrounding slashes", async () => {
    const projectFolder = { id: 9, parentId: null, name: "My-React-App" };
    spies.listWorkspaceFilesForUser.mockResolvedValue([
      { id: 3, folderId: 9, name: "index.html", content: "<html>app</html>" },
    ]);
    spies.listWorkspaceFoldersForUser.mockResolvedValue([folders[0], projectFolder]);

    const result = await deployWorkspaceSite(1, "/my-react-app/", { description: "test site" });
    expect(result.ok).toBe(true);
    const files = spies.deployFilesToNetlifySite.mock.calls[0][1];
    expect(files.map((file: { path: string }) => file.path)).toEqual(["/index.html"]);
  });

  it("refuses an empty or unknown directory with a clear message", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile, nestedFile]);
    spies.listWorkspaceFoldersForUser.mockResolvedValue(folders);

    const result = await deployWorkspaceSite(1, "ghost-folder", { description: "test site" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("nothing to deploy in /ghost-folder");
    expect(spies.createNetlifySite).not.toHaveBeenCalled();
  });

  it("requires the index.html at the root of the chosen directory, not elsewhere", async () => {
    const projectFolder = { id: 9, parentId: null, name: "my-react-app" };
    spies.listWorkspaceFilesForUser.mockResolvedValue([
      indexFile, // at the workspace root - does not count for a directory deploy
      { id: 3, folderId: 9, name: "styles.css", content: "body{}" },
    ]);
    spies.listWorkspaceFoldersForUser.mockResolvedValue([folders[0], projectFolder]);

    const result = await deployWorkspaceSite(1, "my-react-app", { description: "test site" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("index.html");
    if (!result.ok) expect(result.message).toContain("my-react-app");
    expect(spies.createNetlifySite).not.toHaveBeenCalled();
  });

  it("surfaces configuration and history for the deployments page", async () => {
    spies.listSiteDeploymentsForUser.mockResolvedValue([{ id: 30, status: "live" }]);
    const status = await getDeploymentStatusForUser(1);
    expect(status).toMatchObject({ configured: true, latest: null, history: [{ id: 30, status: "live" }] });
    spies.isNetlifyConfigured.mockImplementation(() => false);
    expect((await getDeploymentStatusForUser(1)).configured).toBe(false);
  });

  it("describes the deployment registry for the system prompt", async () => {
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([
      registryEntry(),
      registryEntry({ key: "d-02", siteId: "site-2", siteUrl: "https://nova-bakery.netlify.app", description: "bakery landing page" }),
    ]);
    const line = await describeDeploymentsForUser(1);
    expect(line).toContain("d-01 (live, https://nova-old-site.netlify.app) - portfolio site");
    expect(line).toContain("d-02 (live, https://nova-bakery.netlify.app) - bakery landing page");
  });

  it("reports an empty registry plainly for the system prompt", async () => {
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([]);
    const line = await describeDeploymentsForUser(1);
    expect(line).toContain("none yet");
  });
});

describe("deleteWorkspaceSite", () => {
  const liveEntry = registryEntry();

  beforeEach(() => {
    spies.deleteNetlifySite.mockClear();
    spies.markSiteDeploymentsDeletedForUser.mockClear().mockResolvedValue(1);
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([liveEntry]);
    spies.getSiteDeploymentByKeyForUser.mockImplementation(async (_owner: number, key: string) =>
      key.toLowerCase() === "d-01" ? liveEntry : null
    );
  });

  it("deletes one deployment by its ID and marks its records deleted", async () => {
    const result = await deleteWorkspaceSite(1, { deployment: "d-01" });
    expect(result).toEqual({
      ok: true,
      deleted: [{ key: "d-01", siteId: "site-old", siteUrl: "https://nova-old-site.netlify.app", description: "portfolio site" }],
      failed: 0,
    });
    expect(spies.deleteNetlifySite).toHaveBeenCalledWith("site-old");
    expect(spies.markSiteDeploymentsDeletedForUser).toHaveBeenCalledWith(1, "site-old");
  });

  it("refuses to delete anything without naming a deployment ID", async () => {
    const result = await deleteWorkspaceSite(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Name the deployment");
      expect(result.message).toContain("d-01");
    }
    expect(spies.deleteNetlifySite).not.toHaveBeenCalled();
  });

  it("refuses an unknown deployment ID and lists the known ones", async () => {
    const result = await deleteWorkspaceSite(1, { deployment: "d-99" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("no deployment 'd-99'");
      expect(result.message).toContain("d-01");
    }
    expect(spies.deleteNetlifySite).not.toHaveBeenCalled();
  });

  it("refuses an already-deleted deployment", async () => {
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([registryEntry({ status: "deleted" })]);
    const result = await deleteWorkspaceSite(1, { deployment: "d-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("already deleted");
    expect(spies.deleteNetlifySite).not.toHaveBeenCalled();
  });

  it("lists the sweep targets without deleting when all: true is unconfirmed", async () => {
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([
      liveEntry,
      registryEntry({ key: "d-02", siteId: "site-2", siteUrl: "https://nova-bakery.netlify.app", description: "bakery landing page" }),
    ]);
    const result = await deleteWorkspaceSite(1, { all: true });
    expect(result).toMatchObject({
      ok: false,
      confirmationRequired: true,
      targets: [
        { key: "d-01", siteId: "site-old", siteUrl: "https://nova-old-site.netlify.app" },
        { key: "d-02", siteId: "site-2", siteUrl: "https://nova-bakery.netlify.app" },
      ],
    });
    if (!result.ok && "targets" in result) expect(result.message).toContain("d-01");
    expect(spies.deleteNetlifySite).not.toHaveBeenCalled();
    expect(spies.markSiteDeploymentsDeletedForUser).not.toHaveBeenCalled();
  });

  it("deletes every deployment when all: true is confirmed with exactly the listed IDs", async () => {
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([
      liveEntry,
      registryEntry({ key: "d-02", siteId: "site-2", siteUrl: "https://nova-bakery.netlify.app" }),
    ]);
    const result = await deleteWorkspaceSite(1, { all: true, confirmAll: ["d-01", "d-02"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted).toEqual([
        { key: "d-01", siteId: "site-old", siteUrl: "https://nova-old-site.netlify.app", description: "portfolio site" },
        { key: "d-02", siteId: "site-2", siteUrl: "https://nova-bakery.netlify.app", description: "portfolio site" },
      ]);
      expect(result.failed).toBe(0);
    }
    expect(spies.deleteNetlifySite).toHaveBeenCalledTimes(2);
    expect(spies.markSiteDeploymentsDeletedForUser).toHaveBeenCalledTimes(2);
  });

  it("refuses a stale or partial confirmation for the sweep", async () => {
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([
      liveEntry,
      registryEntry({ key: "d-02", siteId: "site-2", siteUrl: "https://nova-bakery.netlify.app" }),
    ]);
    const result = await deleteWorkspaceSite(1, { all: true, confirmAll: ["d-01"] }); // missing d-02
    expect(result).toMatchObject({ ok: false, confirmationRequired: true });
    expect(spies.deleteNetlifySite).not.toHaveBeenCalled();
  });

  it("refuses when the workspace has no deployments", async () => {
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([]);
    const result = await deleteWorkspaceSite(1, { deployment: "d-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("no deployed websites");
    expect(spies.deleteNetlifySite).not.toHaveBeenCalled();
  });

  it("refuses when hosting is not configured", async () => {
    spies.isNetlifyConfigured.mockImplementation(() => false);
    const result = await deleteWorkspaceSite(1, { deployment: "d-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("NETLIFY_API_TOKEN");
    expect(spies.deleteNetlifySite).not.toHaveBeenCalled();
    spies.isNetlifyConfigured.mockImplementation(() => true);
  });

  it("treats a Netlify 404 as already-deleted and still marks the records", async () => {
    spies.deleteNetlifySite.mockResolvedValue(undefined); // our client swallows 404s
    const result = await deleteWorkspaceSite(1, { deployment: "d-01" });
    expect(result.ok).toBe(true);
  });

  it("keeps going on partial failures and counts them", async () => {
    spies.listSiteDeploymentRegistryForUser.mockResolvedValue([
      liveEntry,
      registryEntry({ key: "d-02", siteId: "site-2", siteUrl: "https://nova-bakery.netlify.app" }),
    ]);
    spies.deleteNetlifySite
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Netlify responded with status 500."));
    const result = await deleteWorkspaceSite(1, { all: true, confirmAll: ["d-01", "d-02"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted).toHaveLength(1);
      expect(result.failed).toBe(1);
    }
    // The failed deployment's records were NOT marked deleted.
    expect(spies.markSiteDeploymentsDeletedForUser).toHaveBeenCalledTimes(1);
    expect(spies.markSiteDeploymentsDeletedForUser).toHaveBeenCalledWith(1, "site-old");
  });

  it("fails cleanly when every deletion fails", async () => {
    spies.deleteNetlifySite.mockRejectedValue(new Error("Netlify responded with status 500."));
    const result = await deleteWorkspaceSite(1, { deployment: "d-01" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("No deployment was deleted");
    expect(spies.markSiteDeploymentsDeletedForUser).not.toHaveBeenCalled();
  });
});
