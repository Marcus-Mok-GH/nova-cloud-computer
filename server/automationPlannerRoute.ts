import express from "express";
import { parse as parseCookie } from "cookie";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "@shared/const";
import { planAutomation } from "./automationPlanner";
import { createHeartbeatJob } from "./_core/heartbeat";
import { createUserAutomation, deleteUserAutomation, setUserAutomationScheduleTask, updateUserAutomation } from "./userAutomations";

export const automationPlannerRouter = express.Router();
function sessionToken(req: express.Request) { return parseCookie(req.headers.cookie ?? "")[COOKIE_NAME] ?? ""; }
function validateCron(cron: string) { const fields = cron.trim().split(/\s+/); return fields.length === 6 && fields[0] === "0" && fields.every(field => /^[0-9*,\/-]+$/.test(field) && field.length <= 32); }

automationPlannerRouter.post("/api/user-automations/plan", async (req, res) => {
  try {
    const user = await sdk.authenticateRequest(req); if (!user) return res.status(401).json({ error: "Unauthorized" });
    const prompt = req.body?.prompt; const timezone = typeof req.body?.timezone === "string" ? req.body.timezone : "UTC";
    if (typeof prompt !== "string" || prompt.trim().length < 3) return res.status(400).json({ error: "Tell Nova what you want the automation to do." });
    if (prompt.length > 8000) return res.status(400).json({ error: "That automation request is too long. Keep it under 8,000 characters." });
    const plan = await planAutomation(user.id, prompt, timezone);
    if (plan.needsClarification) return res.status(200).json({ created: false, plan, clarification: plan.clarificationQuestion });
    if (!validateCron(plan.scheduleCron)) return res.status(422).json({ error: "Nova generated an invalid schedule. Please make the timing more explicit and try again." });
    const created = await createUserAutomation(user.id, { name: plan.name, instructions: prompt.trim(), frequency: plan.frequency, scheduleCron: plan.scheduleCron, scheduleTimezone: plan.scheduleTimezone, executionPrompt: plan.executionPrompt, args: plan.args, definition: plan.definition });
    const token = sessionToken(req); if (!token) { await deleteUserAutomation(user.id, created.id); return res.status(412).json({ error: "Your Nova session is not ready to schedule this automation. Refresh and try again." }); }
    try {
      const scheduled = await createHeartbeatJob({ name: `nova-user-automation-${created.id}`, cron: plan.scheduleCron, path: "/api/scheduled/user-automation", method: "POST", description: `AI-created automation: ${plan.name}` }, token);
      const linked = await setUserAutomationScheduleTask(user.id, created.id, scheduled.taskUid);
      const enabled = await updateUserAutomation(user.id, created.id, { enabled: true });
      return res.status(201).json({ created: true, automation: enabled ?? linked ?? created, plan });
    } catch (scheduleError) { await deleteUserAutomation(user.id, created.id).catch(() => {}); throw scheduleError; }
  } catch (error) { console.error("Automation planning failed", error); return res.status(422).json({ error: error instanceof Error ? error.message : "Nova could not understand that automation request." }); }
});
