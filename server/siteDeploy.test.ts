import { afterEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  isNetlifyConfigured: vi.fn(() => true),
  createNetlifySite: vi.fn(async () => ({ id: "site-new", name: "nova-fresh-site", url: "https://nova-fresh-site.netlify.app" })),
  deployFilesToNetlifySite: vi.fn(async () => ({ deployId: "dep-new" })),
  getLatestSiteDeploymentForUser: vi.fn(async () => null),
  listSiteDeploymentsForUser: vi.fn(async () => []),
  listWorkspaceFilesForUser: vi.fn(async () => []),
  listWorkspaceFoldersForUser: vi.fn(async () => []),
  recordSiteDeployment: vi.fn(async (_owner: number, input: { siteId: string }) => ({
    id: 31, siteId: input.siteId, siteName: "nova-fresh-site", siteUrl: "https://nova-fresh-site.netlify.app",
    status: "deploying", fileCount: 0, error: null, createdAt: new Date("2026-09-16T12:00:00.000Z"), updatedAt: new Date(),
  })),
  updateSiteDeploymentStatusForUser: vi.fn(async (_owner: number, id: number, status: "live" | "failed", error?: string) => ({
    id, status, error: error ?? null, siteId: "site-new", siteName: "nova-fresh-site", siteUrl: "https://nova-fresh-site.netlify.app",
    fileCount: 2, createdAt: new Date("2026-09-16T12:00:00.000Z"), updatedAt: new Date(),
  })),
}));

vi.mock("./db", () => ({
  getLatestSiteDeploymentForUser: spies.getLatestSiteDeploymentForUser,
  listSiteDeploymentsForUser: spies.listSiteDeploymentsForUser,
  listWorkspaceFilesForUser: spies.listWorkspaceFilesForUser,
  listWorkspaceFoldersForUser: spies.listWorkspaceFoldersForUser,
  recordSiteDeployment: spies.recordSiteDeployment,
  updateSiteDeploymentStatusForUser: spies.updateSiteDeploymentStatusForUser,
}));
vi.mock("./netlify", () => ({
  isNetlifyConfigured: spies.isNetlifyConfigured,
  createNetlifySite: spies.createNetlifySite,
  deployFilesToNetlifySite: spies.deployFilesToNetlifySite,
}));

const { deployWorkspaceSite, getDeploymentStatusForUser } = await import("./siteDeploy");

const indexFile = { id: 1, folderId: null, name: "index.html", content: "<html>hi</html>" };
const nestedFile = { id: 2, folderId: 5, name: "about.html", content: "about" };
const folders = [{ id: 5, parentId: null, name: "site" }];

describe("Workspace website deployer", () => {
  afterEach(() => {
    vi.clearAllMocks();
    spies.isNetlifyConfigured.mockImplementation(() => true);
    spies.getLatestSiteDeploymentForUser.mockResolvedValue(null);
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
    const result = await deployWorkspaceSite(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("index.html");
    expect(spies.createNetlifySite).not.toHaveBeenCalled();
  });

  it("publishes the workspace with folder paths and creates a site on first deploy", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile, nestedFile]);
    spies.listWorkspaceFoldersForUser.mockResolvedValue(folders);

    const result = await deployWorkspaceSite(1);
    expect(result.ok).toBe(true);
    expect(spies.createNetlifySite).toHaveBeenCalledTimes(1);
    const [siteId, files] = spies.deployFilesToNetlifySite.mock.calls[0];
    expect(siteId).toBe("site-new");
    expect(files.map((file: { path: string }) => file.path)).toEqual(["/index.html", "/site/about.html"]);
    expect(files[0].content.toString()).toBe("<html>hi</html>");
    const [owner, record] = spies.recordSiteDeployment.mock.calls[0];
    expect(owner).toBe(1);
    expect(record).toMatchObject({ siteId: "site-new", fileCount: 2, status: "deploying" });
    expect(spies.updateSiteDeploymentStatusForUser).toHaveBeenCalledWith(1, 31, "live");
  });

  it("reuses the existing site so the live URL stays stable", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.getLatestSiteDeploymentForUser.mockResolvedValue({
      id: 30, siteId: "site-old", siteName: "nova-old-site", siteUrl: "https://nova-old-site.netlify.app",
      status: "live", fileCount: 2, error: null, createdAt: new Date(), updatedAt: new Date(),
    });

    const result = await deployWorkspaceSite(1);
    expect(result.ok).toBe(true);
    expect(spies.createNetlifySite).not.toHaveBeenCalled();
    expect(spies.deployFilesToNetlifySite).toHaveBeenCalledWith("site-old", expect.anything());
    expect(spies.recordSiteDeployment.mock.calls[0][1]).toMatchObject({
      siteId: "site-old",
      siteUrl: "https://nova-old-site.netlify.app",
    });
  });

  it("decodes binary data-URI files into their real bytes", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([
      indexFile,
      { id: 2, folderId: null, name: "logo.png", content: "data:image/png;base64,aGVsbG8=" },
    ]);
    const result = await deployWorkspaceSite(1);
    expect(result.ok).toBe(true);
    const files = spies.deployFilesToNetlifySite.mock.calls[0][1];
    const logo = files.find((file: { path: string }) => file.path === "/logo.png");
    expect(logo.content.toString("utf8")).toBe("hello");
  });

  it("records the failure when Netlify rejects the deployment", async () => {
    spies.listWorkspaceFilesForUser.mockResolvedValue([indexFile]);
    spies.deployFilesToNetlifySite.mockRejectedValue(new Error("status 429: slow down"));

    const result = await deployWorkspaceSite(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("status 429");
    expect(spies.updateSiteDeploymentStatusForUser).toHaveBeenCalledWith(1, 31, "failed", "status 429: slow down");
  });

  it("surfaces configuration and history for the deployments page", async () => {
    spies.listSiteDeploymentsForUser.mockResolvedValue([{ id: 30, status: "live" }]);
    const status = await getDeploymentStatusForUser(1);
    expect(status).toMatchObject({ configured: true, latest: null, history: [{ id: 30, status: "live" }] });
    spies.isNetlifyConfigured.mockImplementation(() => false);
    expect((await getDeploymentStatusForUser(1)).configured).toBe(false);
  });
});
