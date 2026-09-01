import { invokeLLM } from "./_core/llm";
import { getWorkspaceAgentConnection } from "./workspaceAgent";

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

const schema = {
  name: "automation_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      frequency: { type: "string", enum: ["hourly", "daily", "weekdays", "weekly", "custom"] },
      scheduleCron: { type: "string", minLength: 11, maxLength: 64 },
      scheduleTimezone: { type: "string", minLength: 1, maxLength: 80 },
      scheduleHuman: { type: "string", minLength: 1, maxLength: 200 },
      executionPrompt: { type: "string", minLength: 3, maxLength: 8000 },
      args: { type: "object", additionalProperties: true },
      definition: { type: "object", additionalProperties: true },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      needsClarification: { type: "boolean" },
      clarificationQuestion: { type: ["string", "null"], maxLength: 500 },
    },
    required: ["name", "frequency", "scheduleCron", "scheduleTimezone", "scheduleHuman", "executionPrompt", "args", "definition", "confidence", "needsClarification", "clarificationQuestion"],
  },
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

export async function planAutomation(ownerId: number, request: string, userTimezone = "UTC") {
  const cleaned = request.trim();
  if (cleaned.length < 3) throw new Error("Tell Nova what you want the automation to do.");
  if (cleaned.length > 8000) throw new Error("That automation request is too long. Keep it under 8,000 characters.");
  const connection = await getWorkspaceAgentConnection(ownerId);
  if (!connection?.apiUrl || !connection.apiKey) throw new Error("Nova needs a configured workspace AI model before it can create automations.");

  const now = new Date().toISOString();
  const result = await invokeLLM({
    model: connection.model,
    apiUrl: connection.apiUrl,
    apiKey: connection.apiKey,
    messages: [
      {
        role: "system",
        content: [
          "You are Nova's automation compiler. Convert a user's natural-language recurring-job request into a safe, executable structured automation.",
          "Return ONLY the requested JSON schema.",
          "The scheduler accepts exactly six cron fields: second minute hour day-of-month month day-of-week, in UTC. The first field MUST be 0. Never schedule more frequently than once per minute.",
          `The user's IANA timezone is ${userTimezone}. Current UTC time is ${now}. Convert explicit local times into a UTC cron using this timezone. Store the original timezone too. If the request depends on daylight-saving changes, set definition.scheduleNote explaining that the current scheduler is UTC-based and set needsClarification=true if exact local wall-clock behavior cannot be represented safely.`,
          "If the user did not provide a usable schedule, choose needsClarification=true and ask exactly one concise question about when it should run. Do not silently invent a schedule.",
          "If the requested task is destructive, irreversible, security-sensitive, asks for secrets, or requires an unavailable external integration, do not invent permissions or credentials. Mark the definition with requiresApproval=true and explain the limitation in definition.constraints.",
          "executionPrompt is the prompt that will be sent to Nova's LLM at every run. It must contain the user's intent, relevant args, explicit boundaries, and an instruction to report what it actually did rather than claim unavailable actions.",
          "args should contain reusable parameters extracted from the request, such as repository, paths, recipient, filters, thresholds, or output format. Never put passwords, API keys, bot tokens, cookies, or other secrets into args.",
          "definition should be a compact machine-readable plan with intent, trigger, steps, args, output, constraints, and safety fields. Do not put executable code in it.",
        ].join("\n"),
      },
      { role: "user", content: cleaned },
    ],
    outputSchema: schema,
    maxTokens: 2500,
  });
  const raw = result.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") throw new Error("Nova did not return an automation plan.");
  let parsed: PlannedAutomation;
  try { parsed = JSON.parse(raw) as PlannedAutomation; } catch { throw new Error("Nova returned an invalid automation plan. Please try again."); }
  return sanitizePlan(parsed, userTimezone);
}
