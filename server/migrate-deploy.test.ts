import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectSpy, querySpy, endSpy, constructorConfigs } = vi.hoisted(() => ({
  connectSpy: vi.fn(),
  querySpy: vi.fn(),
  endSpy: vi.fn(),
  constructorConfigs: [] as Array<Record<string, unknown>>,
}));

vi.mock("pg", () => ({
  default: {
    Client: vi.fn((config: Record<string, unknown>) => {
      constructorConfigs.push(config);
      return { connect: connectSpy, query: querySpy, end: endSpy };
    }),
  },
}));

const { probeDatabase, resolveDatabaseUrl, runDeployMigrations } = await import(
  "./migrate-deploy"
);

const UNPOOLED = "postgresql://user:password@db.example.com/prod";
const POOLED = "postgresql://user:password@db-pooler.example.com/prod";

describe("the deploy migration gate", () => {
  beforeEach(() => {
    connectSpy.mockReset().mockResolvedValue(undefined);
    querySpy.mockReset().mockResolvedValue({ rows: [{}] });
    endSpy.mockReset().mockResolvedValue(undefined);
    constructorConfigs.length = 0;
  });

  it("resolves the unpooled URL before the pooled one", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL_UNPOOLED: UNPOOLED, DATABASE_URL: POOLED })).toBe(
      UNPOOLED
    );
    expect(resolveDatabaseUrl({ DATABASE_URL: POOLED })).toBe(POOLED);
    expect(resolveDatabaseUrl({})).toBeNull();
  });

  it("reports a reachable database over the drizzle-kit connection string", async () => {
    await expect(probeDatabase(UNPOOLED, 5_000)).resolves.toEqual({ ok: true });
    expect(constructorConfigs[0]).toMatchObject({
      connectionString: UNPOOLED,
      connectionTimeoutMillis: 5_000,
    });
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledWith("select 1");
  });

  it("surfaces the driver's error when the connection is refused", async () => {
    connectSpy.mockRejectedValue(
      new Error("Your account or project has exceeded the quota.")
    );
    await expect(probeDatabase(UNPOOLED)).resolves.toEqual({
      ok: false,
      reason: "Your account or project has exceeded the quota.",
    });
  });

  it("ends the client even when the probe fails", async () => {
    connectSpy.mockRejectedValue(new Error("connection refused"));
    await probeDatabase(UNPOOLED);
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("skips cleanly when no database URL is configured", async () => {
    const probe = vi.fn();
    const migrate = vi.fn(() => ({ status: 0 }));
    const log = vi.fn();
    const warn = vi.fn();

    const exitCode = await runDeployMigrations({
      env: {},
      probe,
      migrate,
      log,
      warn,
    });

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "Skipping migrations (no database URL in this environment)"
    );
    expect(probe).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
  });

  it("probes the unpooled URL and runs migrations when it answers", async () => {
    const probe = vi.fn(async () => ({ ok: true } as const));
    const migrate = vi.fn(() => ({ status: 0 }));
    const log = vi.fn();

    const exitCode = await runDeployMigrations({
      env: { DATABASE_URL_UNPOOLED: UNPOOLED, DATABASE_URL: POOLED },
      probe,
      migrate,
      log,
    });

    expect(exitCode).toBe(0);
    expect(probe).toHaveBeenCalledWith(UNPOOLED);
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it("still fails the build when migrations fail against a reachable database", async () => {
    const probe = vi.fn(async () => ({ ok: true } as const));
    const migrate = vi.fn(() => ({ status: 1 }));

    await expect(
      runDeployMigrations({ env: { DATABASE_URL: POOLED }, probe, migrate })
    ).resolves.toBe(1);

    migrate.mockReturnValue({ status: null });
    await expect(
      runDeployMigrations({ env: { DATABASE_URL: POOLED }, probe, migrate })
    ).resolves.toBe(1);
  });

  it("warns with the underlying error and ships when the database is unreachable", async () => {
    const probe = vi.fn(async () => ({
      ok: false,
      reason: "Your account or project has exceeded the quota.",
    } as const));
    const migrate = vi.fn(() => ({ status: 0 }));
    const log = vi.fn();
    const warn = vi.fn();

    const exitCode = await runDeployMigrations({
      env: { DATABASE_URL: POOLED },
      probe,
      migrate,
      log,
      warn,
    });

    // The whole point: an outage must not take the deploy down with it, but
    // the real reason has to stay visible in the build log.
    expect(exitCode).toBe(0);
    expect(migrate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[migrate-deploy] Database unreachable: Your account or project has exceeded the quota."
    );
    expect(
      warn.mock.calls.some(([message]) =>
        String(message).includes("runtime bootstrap")
      )
    ).toBe(true);
  });

  it("fails the build when pnpm itself cannot be spawned", async () => {
    const probe = vi.fn(async () => ({ ok: true } as const));
    const migrate = vi.fn(() => ({
      status: null,
      error: new Error("spawn pnpm ENOENT"),
    }));
    const warn = vi.fn();

    await expect(
      runDeployMigrations({ env: { DATABASE_URL: POOLED }, probe, migrate, warn })
    ).resolves.toBe(1);
    expect(
      warn.mock.calls.some(([message]) => String(message).includes("ENOENT"))
    ).toBe(true);
  });
});
