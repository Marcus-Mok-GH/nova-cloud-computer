/**
 * Shape of the /api/status report shared by the server collector and the
 * client status page. Keep this in sync with server/status.ts.
 *
 * Everything in this report is user-facing: services describe user-visible
 * capabilities (web app, workspace data, AI responses, ...) in plain language.
 * Internal services, provider names, environment variable names, and raw
 * backend error messages must never appear here.
 */

export type ServiceState = "operational" | "degraded" | "offline" | "unconfigured";

export type ServiceHealth = {
  id: string;
  name: string;
  state: ServiceState;
  detail: string;
  latencyMs: number | null;
};

export type ServiceStatusReport = {
  checkedAt: string;
  serverUptimeSeconds: number;
  services: ServiceHealth[];
};
