import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { runAutomationForScheduleTask } from "./automations";

export const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

/**
 * Platform-owned cron callbacks authenticate to a persisted, opaque task UID.
 * The UID is resolved in the database, never accepted from request payloads.
 */
app.post("/api/scheduled/automation", async (req: express.Request, res: express.Response) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });

    const outcome = await runAutomationForScheduleTask(user.taskUid);
    if (!outcome) return res.status(200).json({ ok: true, skipped: "orphaned-schedule" });
    if (outcome.failed > 0) {
      throw new Error("The scheduled automation recorded a failed run and will be retried.");
    }

    return res.status(200).json({ ok: true, outcome });
  } catch (error) {
    console.error("[Automation schedule] Callback failed", error);
    return res.status(500).json({
      error: "automation-callback-failed",
      timestamp: new Date().toISOString(),
      context: { path: req.path },
    });
  }
});

app.get("/api/health", (_req: express.Request, res: express.Response) => res.status(200).json({ ok: true, service: "nova" }));
