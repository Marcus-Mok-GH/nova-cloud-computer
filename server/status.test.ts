import { describe, expect, it, vi } from "vitest";
import { collectServiceStatus } from "./status";

const healthyInference = {
  provider: "mistral" as const,
  model: "chat-small-latest",
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
      "web",
      "data",
      "ai",
      "telegram",
      "connectors",
      "sandbox",
    ]);
    for (const service of report.services) {
      expect(service.state).toBe("operational");
    }
    expect(report.services.find(service => service.id === "data")?.latencyMs).toBeGreaterThan(0);
    expect(report.services.find(service => service.id === "telegram")?.detail).toContain("@nova_bot");
  });

  it("never exposes internal services, backend names, env vars, or raw errors in the report", async () => {
    const deps = baseDeps();
    deps.dbProbe = vi.fn(async () => {
      throw new Error("connection refused to postgres://user:pass@db.internal:5432");
    });
    deps.inferenceStatus = vi.fn(async () => {
      throw new Error("fetch failed for https://api.mistral.ai/v1/models");
    });
    deps.telegramCheck = vi.fn(async () => {
      throw new Error("DEFAULT_TELEGRAM_BOT_TOKEN is not set on this server");
    });
    deps.workspaceLookup = vi.fn(async () => {
      throw new Error("E2B workspace lookup failed");
    });
    const report = await collectServiceStatus(1, deps);
    const text = report.services.map(service => `${service.name}: ${service.detail}`).join("\n");
    for (const banned of ["Neon", "Mistral", "gateway", "database", "E2B", "COMPOSIO", "TELEGRAM_BOT_TOKEN", "postgres", "http://", "https://", "connection refused", "fetch failed", "not set on this server"]) {
      expect(text).not.toContain(banned);
    }
    // Every service still reports a state; failures degrade to a generic detail.
    expect(report.services).toHaveLength(6);
    expect(report.services.find(service => service.id === "data")?.detail).toBe("Temporarily unavailable");
    expect(report.services.find(service => service.id === "ai")?.state).toBe("offline");
  });

  it("marks workspace data offline when the probe fails, without failing the report", async () => {
    const deps = baseDeps();
    deps.dbProbe = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const report = await collectServiceStatus(1, deps);
    const data = report.services.find(service => service.id === "data");
    expect(data?.state).toBe("offline");
    expect(data?.detail).toBe("Temporarily unavailable");
    expect(data?.detail).not.toContain("connection refused");
    expect(report.services.find(service => service.id === "web")?.state).toBe("operational");
  });

  it("downgrades AI responses to degraded when the daily allowance is exhausted", async () => {
    const deps = baseDeps();
    deps.inferenceStatus = vi.fn(async () => ({
      ...healthyInference,
      allowance: { usedRequests: 500, maxRequests: 500, remainingRequests: 0, exhausted: true },
    }));
    const report = await collectServiceStatus(1, deps);
    expect(report.services.find(service => service.id === "ai")?.state).toBe("degraded");
  });

  it("labels optional integrations as unconfigured rather than offline", async () => {
    const deps = baseDeps();
    deps.telegramCheck = vi.fn(async () => ({ configured: false, reachable: false, botUsername: null }));
    deps.composioConfigured = () => false;
    deps.workspaceLookup = vi.fn(async () => ({ persistentSandboxId: null }));
    const report = await collectServiceStatus(1, deps);
    expect(report.services.find(service => service.id === "telegram")?.state).toBe("unconfigured");
    expect(report.services.find(service => service.id === "connectors")?.state).toBe("unconfigured");
    expect(report.services.find(service => service.id === "sandbox")?.state).toBe("unconfigured");
  });

  it("reports a configured but unreachable telegram bot as offline", async () => {
    const deps = baseDeps();
    deps.telegramCheck = vi.fn(async () => ({ configured: true, reachable: false, botUsername: null }));
    const report = await collectServiceStatus(1, deps);
    expect(report.services.find(service => service.id === "telegram")?.state).toBe("offline");
    expect(report.services.find(service => service.id === "telegram")?.detail).toBe("Not responding right now");
  });
});

describe("collectServiceStatus AI configuration", () => {
  it("labels AI responses unconfigured when no provider is set up", async () => {
    const deps = baseDeps();
    deps.inferenceConfigured = () => false;
    const report = await collectServiceStatus(1, deps);
    expect(report.services.find(service => service.id === "ai")?.state).toBe("unconfigured");
  });
});
