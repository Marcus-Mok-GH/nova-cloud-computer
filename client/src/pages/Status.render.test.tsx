import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Status, { APP_PAGES, StateChip } from "./Status";
import type { ServiceStatusReport } from "@shared/serviceStatus";

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main data-testid="status-shell">{children}</main> }));

const sampleReport: ServiceStatusReport = {
  checkedAt: "2026-09-26T12:00:00.000Z",
  serverUptimeSeconds: 3_725,
  services: [
    { id: "api", name: "Nova API server", state: "operational", detail: "Responding · uptime 1h 2m", latencyMs: null },
    { id: "database", name: "Neon database", state: "operational", detail: "Query round-trip succeeded", latencyMs: 42 },
    { id: "inference", name: "Inference gateway (Mistral)", state: "degraded", detail: "Reachable but allowance exhausted (500/500 requests used)", latencyMs: null },
    { id: "telegram", name: "Telegram bot", state: "unconfigured", detail: "DEFAULT_TELEGRAM_BOT_TOKEN is not set on this server", latencyMs: null },
    { id: "composio", name: "Composio connectors", state: "operational", detail: "Project API key is set", latencyMs: null },
    { id: "sandbox", name: "Persistent sandbox", state: "offline", detail: "Workspace lookup failed", latencyMs: null },
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
});
