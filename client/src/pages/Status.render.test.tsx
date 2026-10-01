import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Status, { APP_PAGES, StateChip, filterPublicServices } from "./Status";
import type { ServiceStatusReport } from "@shared/serviceStatus";

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="status-shell">{children}</main> }));

const sampleReport: ServiceStatusReport = {
  checkedAt: "2026-09-26T12:00:00.000Z",
  serverUptimeSeconds: 3_725,
  services: [
    { id: "web", name: "Web app", state: "operational", detail: "Responding · uptime 1h 2m", latencyMs: null },
    { id: "data", name: "Workspace data", state: "operational", detail: "Read and write check succeeded", latencyMs: 42 },
    { id: "ai", name: "AI responses", state: "degraded", detail: "Daily request allowance used up (500/500 requests)", latencyMs: null },
    { id: "telegram", name: "Telegram", state: "unconfigured", detail: "Not set up on this workspace yet", latencyMs: null },
    { id: "connectors", name: "Connectors", state: "operational", detail: "Ready to connect apps like GitHub and Gmail", latencyMs: null },
    { id: "sandbox", name: "Workspace sandbox", state: "offline", detail: "Temporarily unavailable", latencyMs: null },
    // An internal/backend service: must never reach the rendered UI.
    { id: "database", name: "Neon database", state: "offline", detail: "DEFAULT_TELEGRAM_BOT_TOKEN is not set on this server", latencyMs: null },
    { id: "inference", name: "Inference gateway (Mistral)", state: "offline", detail: "fetch failed to https://api.mistral.ai/v1/chat/completions", latencyMs: null },
  ],
};

describe("StateChip", () => {
  it("labels each service state distinctly", () => {
    expect(renderToStaticMarkup(<StateChip state="operational" />)).toContain("Operational");
    expect(renderToStaticMarkup(<StateChip state="degraded" />)).toContain("Degraded");
    expect(renderToStaticMarkup(<StateChip state="offline" />)).toContain("Offline");
    expect(renderToStaticMarkup(<StateChip state="unconfigured" />)).toContain("Not configured");
  });
});

describe("filterPublicServices", () => {
  it("keeps only user-facing services and drops internal ones", () => {
    const visible = filterPublicServices(sampleReport.services);
    expect(visible.map(service => service.id)).toEqual(["web", "data", "ai", "telegram", "connectors", "sandbox"]);
    const text = visible.map(service => `${service.name}: ${service.detail}`).join("\n");
    expect(text).not.toContain("Neon");
    expect(text).not.toContain("Mistral");
    expect(text).not.toContain("DEFAULT_TELEGRAM_BOT_TOKEN");
    expect(text).not.toContain("api.mistral.ai");
  });

  it("returns an empty list for a report that only contains internal services", () => {
    const internalOnly = sampleReport.services.filter(service => !["web", "data", "ai", "telegram", "connectors", "sandbox"].includes(service.id));
    expect(filterPublicServices(internalOnly)).toEqual([]);
  });
});

describe("Status page", () => {
  it("covers every app route in the page probe list", () => {
    const paths = APP_PAGES.map(page => page.path);
    expect(paths).toEqual(["/", "/sign-in", "/app", "/app/files", "/app/chats", "/app/deployments", "/app/terminal", "/app/profile", "/app/settings", "/app/status", "/app/more"]);
  });

  it("renders the status page skeleton with Services and Pages sections", () => {
    const markup = renderToStaticMarkup(<Status />);
    expect(markup).toContain("Status");
    expect(markup).toContain("Services");
    expect(markup).toContain("Pages");
    expect(markup).toContain("Collecting service health");
    expect(markup).toContain("checking…");
  });

  it("never mentions internal backend services in its own copy", () => {
    const markup = renderToStaticMarkup(<Status />);
    for (const banned of ["Neon", "Mistral", "gateway", "database", "E2B", "COMPOSIO", "status endpoint"]) {
      expect(markup).not.toContain(banned);
    }
  });
});
