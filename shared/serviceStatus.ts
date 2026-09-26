/**
 * Shape of the /api/status report shared by the server collector and the
 * client status page. Keep this in sync with server/status.ts.
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
