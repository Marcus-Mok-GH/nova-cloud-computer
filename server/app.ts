import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { isAuthorizedAutomationCron, runDueAutomations } from "./automations";

export const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
app.get("/api/health", (_req: express.Request, res: express.Response) => res.status(200).json({ ok: true, service: "nova" }));
app.get("/api/automations/cron", async (req: express.Request, res: express.Response) => {
  if (!isAuthorizedAutomationCron(req.header("authorization") ?? undefined)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  try {
    const outcome = await runDueAutomations();
    return res.status(200).json({ ok: true, ...outcome });
  } catch (error) {
    console.error("[Automations] Scheduled runner failed", error);
    return res.status(500).json({ ok: false, error: "Automation runner failed" });
  }
});
