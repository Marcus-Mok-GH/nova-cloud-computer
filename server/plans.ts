import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { agentPlans, type AgentPlan, type AgentPlanStep, type AgentPlanStepStatusValue } from "../drizzle/schema";

let db: ReturnType<typeof drizzle> | null = null;
async function getDb() { if (!db && process.env.DATABASE_URL) db = drizzle(neon(process.env.DATABASE_URL)); if (!db) throw new Error("The Nova database is unavailable."); return db; }

export const AGENT_PLAN_STEP_STATUSES: readonly AgentPlanStepStatusValue[] = ["pending", "in_progress", "done", "skipped"];
export const MAX_PLAN_STEPS = 25;
export const MAX_PLAN_TITLE_CHARS = 240;

export function isAgentPlanStepStatus(value: unknown): value is AgentPlanStepStatusValue {
  return typeof value === "string" && (AGENT_PLAN_STEP_STATUSES as readonly string[]).includes(value);
}

/** Normalizes raw model output into valid plan steps; invalid rows drop to pending. */
export function normalizePlanSteps(raw: unknown): AgentPlanStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map(s => ({
      text: typeof s.text === "string" ? s.text.replace(/\s+/g, " ").trim().slice(0, 400) : "",
      status: isAgentPlanStepStatus(s.status) ? s.status : "pending",
    }))
    .filter(s => s.text.length > 0)
    .slice(0, MAX_PLAN_STEPS);
}

/** One active plan per chat: creating a new plan replaces the previous one. */
export async function upsertAgentPlanForChat(ownerId: number, chatId: number, input: { title: string; steps: unknown }): Promise<AgentPlan> {
  const database = await getDb();
  const steps = normalizePlanSteps(input.steps);
  if (!steps.length) throw new Error("A plan needs at least one step with text.");
  const title = (input.title || "").replace(/\s+/g, " ").trim().slice(0, MAX_PLAN_TITLE_CHARS) || "Working plan";
  const existing = await getActiveAgentPlanForChat(ownerId, chatId);
  if (existing) {
    const [updated] = await database.update(agentPlans).set({ title, steps, updatedAt: new Date() }).where(eq(agentPlans.id, existing.id)).returning();
    if (!updated) throw new Error("Nova could not update that plan.");
    return updated;
  }
  const [created] = await database.insert(agentPlans).values({ ownerId, chatId, title, steps }).returning();
  if (!created) throw new Error("Nova could not save that plan.");
  return created;
}

export async function getActiveAgentPlanForChat(ownerId: number, chatId: number): Promise<AgentPlan | undefined> {
  const database = await getDb();
  return (await database.select().from(agentPlans).where(and(eq(agentPlans.chatId, chatId), eq(agentPlans.ownerId, ownerId))).limit(1))[0];
}

/** Compact plan summary injected into the system prompt. */
export function planPromptLine(plan: AgentPlan | undefined): string {
  if (!plan) return "";
  const lines = plan.steps.map(s => `- [${s.status}] ${s.text}`);
  return `Your current working plan for this chat ("${plan.title}"). Keep it true: mark steps done or skipped with plan_update as you go, and rewrite the plan when reality diverges instead of silently drifting:\n${lines.join("\n")}`;
}

export function formatPlanForTool(plan: AgentPlan): string {
  const lines = plan.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.text}`);
  return `Plan "${plan.title}" saved. Steps:\n${lines.join("\n")}`;
}
