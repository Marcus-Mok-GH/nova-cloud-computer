import { describe, expect, it, vi } from "vitest";
import { collectServiceStatus } from "./status";

const healthyInference = {
  provider: "mistral" as const,
  model: "mistral-small-latest",
  configured: true,
  reachable: true,
  providerConfigured: true,
  providerConfigurationKnown: true,
  allowance: { usedRequests: 5, maxRequests: 500, remainingRequests: 495, exhausted: false },
};

function baseDeps() {
  return {
    now: (() => {
      let clock = 1_000;
      return () => (clock += 1);
    })(),
    processUptimeSeconds: () => 3_725,
    dbProbe: vi.fn(async () => {}),
    inferenceStatus: vi.fn(async () => healthyInference),
    inferenceConfigured: () => true,
    telegramCheck: vi.fn(async () => ({ configured: true, reachable: true, botUsername: "nova_bot" })),
    composioConfigured: () => true,
    workspaceLookup: vi.fn(async () => ({ persistentSandboxId: "sbx-123" })),
  };
}

describe("collectServiceStatus", () => {
  it("reports every service operational when all probes pass", async () => {
    const report = await collectServiceStatus(1, baseDeps());
    expect(report.serverUptimeSeconds).toBe(3_725);
    expect(report.services.map(service => service.id)).toEqual([
      "api",
      "database",
      "inference",
      "telegram",
      "composio",
      "sandbox",
    ]);
    for (const service of report.services) {
      expect(service.state).toBe("operational");
    }
    expect(report.services.find(service => service.id === "database")?.latencyMs).toBeGreaterThan(0);
    expect(report.services.find(service => service.id === "telegram")?.detail).toContain("@nova_bot");
  });

  it("marks the database offline when the probe fails, without failing the report", async () => {
    const deps = baseDeps();
    deps.dbProbe = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const report = await collectServiceStatus(1, deps);
    const database = report.services.find(service => service.id === "database");
    expect(database?.state).toBe("offline");
    expect(database?.detail).toContain("connection refused");
    expect(report.services.find(service => service.id === "api")?.state).toBe("operational");
  });

  it("downgrades inference to degraded when the daily allowance is exhausted", async () => {
    const deps = baseDeps();
    deps.inferenceStatus = vi.fn(async () => ({
      ...healthyInference,
      allowance: { usedRequests: 500, maxRequests: 500, remainingRequests: 0, exhausted: true },
    }));
    const report = await collectServiceStatus(1, deps);
    expect(report.services.find(service => service.id === "inference")?.state).toBe("degraded");
  });

  it("labels optional integrations as unconfigured rather than offline", async () => {
    const deps = baseDeps();
    deps.telegramCheck = vi.fn(async () => ({ configured: false, reachable: false, botUsername: null }));
    deps.composioConfigured = () => false;
    deps.workspaceLookup = vi.fn(async () => ({ persistentSandboxId: null }));
    const report = await collectServiceStatus(1, deps);
    expect(report.services.find(service => service.id === "telegram")?.state).toBe("unconfigured");
    expect(report.services.find(service => service.id === "composio")?.state).toBe("unconfigured");
    expect(report.services.find(service => service.id === "sandbox")?.state).toBe("unconfigured");
  });

  it("reports a configured but unreachable telegram bot as offline", async () => {
    const deps = baseDeps();
    deps.telegramCheck = vi.fn(async () => ({ configured: true, reachable: false, botUsername: null }));
    const report = await collectServiceStatus(1, deps);
    expect(report.services.find(service => service.id === "telegram")?.state).toBe("offline");
  });
});

describe("collectServiceStatus inference configuration", () => {
  it("labels the gateway unconfigured when no URL or token is set", async () => {
    const deps = baseDeps();
    deps.inferenceConfigured = () => false;
    const report = await collectServiceStatus(1, deps);
    expect(report.services.find(service => service.id === "inference")?.state).toBe("unconfigured");
  });
});
