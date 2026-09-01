import express from "express";
import { sdk } from "./_core/sdk";
import { planAutomation } from "./automationPlanner";

export const automationPlannerRouter = express.Router();

automationPlannerRouter.post("/api/user-automations/plan", async (req, res) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const prompt = req.body?.prompt;
    const timezone = typeof req.body?.timezone === "string" ? req.body.timezone : "UTC";
    if (typeof prompt !== "string" || prompt.trim().length < 3) return res.status(400).json({ error: "Tell Nova what you want the automation to do." });
    if (prompt.length > 8000) return res.status(400).json({ error: "That automation request is too long. Keep it under 8,000 characters." });
    const plan = await planAutomation(user.id, prompt, timezone);
    if (plan.needsClarification) return res.status(200).json({ created: false, plan, clarification: plan.clarificationQuestion });
    return res.status(201).json({ created: false, plan });
  } catch (error) {
    console.error("Automation planning failed", error);
    return res.status(422).json({ error: error instanceof Error ? error.message : "Nova could not understand that automation request." });
  }
});
