import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Peak-hours queueing is time-of-day dependent; keep the shared suite
    // deterministic and cover the enabled path explicitly in peakQueue tests.
    env: { NOVA_PEAK_QUEUE: "off" },
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "api/**/*.test.ts",
      "api/**/*.spec.ts",
      "client/src/**/*.test.ts",
      "client/src/**/*.spec.ts",
      "client/src/**/*.test.tsx",
      "client/src/**/*.spec.tsx",
    ],
  },
});
