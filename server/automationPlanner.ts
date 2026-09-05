import { ENV } from "./_core/env";
import { z } from "zod";
import { getE2BClient, runOpencodeChatInPersistentSandbox } from "./e2b";
import { getOrCreateWorkspace } from "./db";

export type PlannedAutomation = {
  name: string;
  frequency: "hourly" | "daily" | "weekdays" | "weekly" | "custom";
  scheduleCron: string;
  scheduleTimezone: string;
  scheduleHuman: string;
  executionPrompt: string;
  args: Record<string, unknown>;
  definition: Record<string, unknown>;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion: string | null;
};

function validCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 6 || fields[0] !== "0") return false;
  return fields.every(field => /^[0-9*,\/-]+$/.test(field) && field.length <= 32);
}

function validTimezone(timezone: string): boolean {
  try { Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); return true; } catch { return timezone === "UTC"; }
}

function sanitizePlan(plan: PlannedAutomation, userTimezone: string): PlannedAutomation {
  const timezone = validTimezone(plan.scheduleTimezone) ? plan.scheduleTimezone : userTimezone;
  const normalized = { ...plan, name: plan.name.trim().slice(0, 120), scheduleTimezone: timezone, executionPrompt: plan.executionPrompt.trim().slice(0, 8000) };
  if (!validCron(normalized.scheduleCron)) throw new Error("Nova generated an invalid schedule. Please describe the timing more explicitly and try again.");
  if (normalized.needsClarification && !normalized.clarificationQuestion) throw new Error("Nova could not explain what needs clarification.");
  if (!normalized.needsClarification && normalized.confidence < 0.55) throw new Error("Nova is not confident enough to create this automation safely. Please make the schedule and task more explicit.");
  if (normalized.needsClarification) normalized.confidence = Math.min(normalized.confidence, 0.54);
  return normalized;
}

const automationSystemPrompt = (userTimezone: string, now: string) => [
  "You are Nova's automation compiler. Convert a user's natural-language recurring-job request into a safe, executable structured automation.",
  "Return ONLY the requested JSON object. Do not wrap it in markdown fences or add commentary.",
  "The scheduler accepts exactly six cron fields: second minute hour day-of-month month day-of-week, in UTC. The first field MUST be 0. Never schedule more frequently than once per minute.",
  `The user's IANA timezone is ${userTimezone}. Current UTC time is ${now}. Convert explicit local times into a UTC cron using this timezone. Store the original timezone too. If the request depends on daylight-saving changes, set definition.scheduleNote explaining that the current scheduler is UTC-based and set needsClarification=true if exact local wall-clock behavior cannot be represented safely.`,
  "If the user did not provide a usable schedule, choose needsClarification=true and ask exactly one concise question about when it should run. Do not silently invent a schedule.",
  "If the requested task is destructive, irreversible, security-sensitive, asks for secrets, or requires an unavailable external integration, do not invent permissions or credentials. Mark the definition with requiresApproval=true and explain the limitation in definition.constraints.",
  "executionPrompt is the prompt that will be sent to Nova's LLM at every run. It must contain the user's intent, relevant args, explicit boundaries, and an instruction to report what it actually did rather than claim unavailable actions.",
  "args should contain reusable parameters extracted from the request, such as repository, paths, recipient, filters, thresholds, or output format. Never put passwords, API keys, bot tokens, cookies, or other secrets into args.",
  "definition should be a compact machine-readable plan with intent, trigger, steps, args, output, constraints, and safety fields. Do not put executable code in it.",
].join("\n");

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.filter(part => part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string")
      .map(part => (part as { text: string }).text)
      .join("\n")
      .trim();
    return text || undefined;
  }
  return undefined;
}

const plannedAutomationSchema = z.object({
  name: z.string(),
  frequency: z.enum(["hourly", "daily", "weekdays", "weekly", "custom"]),
  scheduleCron: z.string(),
  scheduleTimezone: z.string(),
  scheduleHuman: z.string(),
  executionPrompt: z.string(),
  args: z.record(z.string(), z.unknown()),
  definition: z.record(z.string(), z.unknown()),
  confidence: z.number().finite().min(0).max(1),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().nullable(),
}).strict();

function parsePlan(raw: string): PlannedAutomation {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return plannedAutomationSchema.parse(JSON.parse(cleaned));
  } catch {
    throw new Error("Nova returned an invalid automation plan. Please try again.");
  }
}

export async function planAutomation(ownerId: number, request: string, userTimezone = "UTC") {
  const cleaned = request.trim();
  if (cleaned.length < 3) throw new Error("Tell Nova what you want the automation to do.");
  if (cleaned.length > 8000) throw new Error("That automation request is too long. Keep it under 8,000 characters.");
  const client = getE2BClient();
  if (!client) throw new Error("Nova’s VM (openCode) isn’t available, so it can’t create automations right now. Please try again shortly.");
  const workspace = await getOrCreateWorkspace(ownerId);

  const now = new Date().toISOString();
  const prompt = [
    automationSystemPrompt(userTimezone, now),
    `Convert this automation request into the requested JSON object.\n${cleaned}`,
  ].join("\n");

  // The VM's opencode agent returns free-form text. Instruct it to emit the plan
  // as a single JSON object and retry a few times if parsing fails, so model
  // output quirks cannot break automation creation.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await runOpencodeChatInPersistentSandbox(client, {
        workspaceId: workspace.id,
        sandboxId: workspace.persistentSandboxId,
        ownerId,
        model: ENV.opencodeZenModel,
        prompt: `${prompt}\n\nReply with ONLY the JSON object.`,
      });
      const raw = extractTextContent(result.reply);
      if (!raw) throw new Error("Nova did not return an automation plan.");
      return sanitizePlan(parsePlan(raw), userTimezone);
    } catch (error) {
      lastError = error;
      console.warn(`Automation planning attempt ${attempt + 1} failed:`, error);
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : "Nova could not create the automation plan. Please try again.");
}
