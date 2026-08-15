import type { AgentDefinition } from "@codebuff/sdk";
import {
  createAgentVmRunForUser,
  createWorkspaceFileForUser,
  getActiveAgentVmRunForUser,
  getCodebuffCredentialsForUser,
  getCodebuffSettingsForUser,
  getWorkspaceFilesByIdsForUser,
  updateAgentVmRunForUser,
} from "./db";

const MAX_SELECTED_FILES = 12;
const MAX_FILE_CHARS = 24_000;
const MAX_BUNDLE_CHARS = 120_000;
const MAX_AGENT_STEPS = 6;
const MAX_PLAN_ITEMS = 12;
const MAX_RUN_MILLISECONDS = 75_000;

type PlannerResult = {
  summary: string;
  steps: string[];
  cautions: string[];
  selectedFileNames: string[];
};

const NOVA_CODEBUFF_PLANNER: AgentDefinition = {
  id: "nova-codebuff-planner",
  version: "1.0.0",
  displayName: "Nova planning-only agent",
  model: "anthropic/claude-sonnet-4.5",
  toolNames: [],
  outputMode: "structured_output",
  outputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "A concise description of the recommended approach." },
      steps: { type: "array", items: { type: "string" }, description: "A short, ordered implementation plan." },
      cautions: { type: "array", items: { type: "string" }, description: "Risks, assumptions, or user approvals needed before execution." },
    },
    required: ["summary", "steps", "cautions"],
  },
  instructionsPrompt: "You are Nova's planning-only agent. Analyze only the project files deliberately provided in the request. You have no filesystem, shell, network, credential, deployment, or sandbox access, and you must not claim to have made changes. Produce a practical implementation plan, identifying uncertainty and approvals where appropriate. Do not request, echo, infer, or expose credentials. Keep the summary concise and return no more than 12 steps or cautions.",
};

function safeFileName(name: string) {
  const normalized = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return normalized || "untitled.txt";
}

function boundedText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 2_000) : fallback;
}

function boundedList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map(item => item.trim().slice(0, 800)).slice(0, MAX_PLAN_ITEMS);
}

function sanitizeError(error: unknown, apiKey: string) {
  const message = error instanceof Error ? error.message : "Nova could not complete that Codebuff planning request.";
  return message
    .replaceAll(apiKey, "[private credential]")
    .replace(/(authorization|bearer|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1: [private credential]")
    .slice(0, 1_000);
}

function buildSelectedBundle(files: Array<{ id: number; name: string; content: string }>) {
  let remainingChars = MAX_BUNDLE_CHARS;
  const projectFiles: Record<string, string> = {};
  for (const file of files) {
    const content = file.content.slice(0, Math.min(MAX_FILE_CHARS, remainingChars));
    projectFiles[`workspace/${file.id}-${safeFileName(file.name)}`] = content;
    remainingChars -= content.length;
    if (remainingChars <= 0) break;
  }
  return projectFiles;
}

function parsePlannerOutput(output: { type: string; value?: unknown; message?: string }, selectedFileNames: string[]): PlannerResult {
  if (output.type === "error") throw new Error(typeof output.message === "string" ? output.message : "Codebuff did not return a planning result.");
  const value = output.type === "structuredOutput" && output.value && typeof output.value === "object" ? output.value as Record<string, unknown> : {};
  const steps = boundedList(value.steps);
  const cautions = boundedList(value.cautions);
  return {
    summary: boundedText(value.summary, steps[0] ?? "Codebuff completed a bounded planning pass for the selected workspace files."),
    steps: steps.length ? steps : ["Review the selected files and turn this draft into an approved execution task."],
    cautions,
    selectedFileNames,
  };
}

function planArtifact(prompt: string, result: PlannerResult) {
  const lines = [
    "# Codebuff planning result",
    "",
    `**Request:** ${prompt}`,
    "",
    "## Summary",
    result.summary,
    "",
    "## Selected files sent to Codebuff",
    ...result.selectedFileNames.map(name => `- ${name}`),
    "",
    "## Suggested steps",
    ...result.steps.map((step, index) => `${index + 1}. ${step}`),
  ];
  if (result.cautions.length) lines.push("", "## Cautions", ...result.cautions.map(caution => `- ${caution}`));
  return `${lines.join("\n")}\n`;
}

export async function getCodebuffPlannerStatus(ownerId: number) {
  const settings = await getCodebuffSettingsForUser(ownerId);
  return {
    ...settings,
    provider: "codebuff" as const,
    limits: {
      maxSelectedFiles: MAX_SELECTED_FILES,
      maxFileChars: MAX_FILE_CHARS,
      maxBundleChars: MAX_BUNDLE_CHARS,
      maxAgentSteps: MAX_AGENT_STEPS,
      timeoutSeconds: Math.floor(MAX_RUN_MILLISECONDS / 1_000),
      execution: "planning_only" as const,
    },
  };
}

export async function startCodebuffPlannerRun(ownerId: number, input: { prompt: string; fileIds: number[] }) {
  const credentials = await getCodebuffCredentialsForUser(ownerId);
  if (!credentials) return { configured: false as const, run: null, plan: null, message: "Add your private Codebuff API key in Settings before starting a planner run." };
  if (input.fileIds.length > MAX_SELECTED_FILES) throw new Error(`Select at most ${MAX_SELECTED_FILES} files for one Codebuff planning request.`);
  const active = await getActiveAgentVmRunForUser(ownerId);
  if (active) throw new Error("This workspace already has active agent work. Wait for it to finish before starting a Codebuff plan.");

  const files = await getWorkspaceFilesByIdsForUser(ownerId, input.fileIds);
  if (files.length !== input.fileIds.length) throw new Error("One or more selected files are not available in your Nova workspace.");
  const projectFiles = buildSelectedBundle(files);
  const run = await createAgentVmRunForUser(ownerId, { provider: "codebuff", task: input.prompt });
  await updateAgentVmRunForUser(ownerId, run.id, { status: "running", startedAt: new Date() });

  try {
    const { CodebuffClient } = await import("@codebuff/sdk");
    const client = new CodebuffClient({
      apiKey: credentials.apiKey,
      projectFiles,
      agentDefinitions: [NOVA_CODEBUFF_PLANNER],
      maxAgentSteps: MAX_AGENT_STEPS,
      env: {},
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAX_RUN_MILLISECONDS);
    const response = await client.run({ agent: "nova-codebuff-planner", prompt: input.prompt, signal: controller.signal }).finally(() => clearTimeout(timeout));
    const plan = parsePlannerOutput(response.output, files.map(file => file.name));
    const artifact = await createWorkspaceFileForUser(ownerId, {
      name: `codebuff-plan-${run.id}.md`,
      content: planArtifact(input.prompt, plan),
      mimeType: "text/markdown",
    });
    const completed = await updateAgentVmRunForUser(ownerId, run.id, {
      status: "succeeded",
      resultSummary: plan.summary,
      artifactFileId: artifact?.id ?? null,
      completedAt: new Date(),
    });
    return { configured: true as const, run: completed, plan, message: `Codebuff returned a planning result using ${files.length} selected workspace file${files.length === 1 ? "" : "s"}.` };
  } catch (error) {
    const message = sanitizeError(error, credentials.apiKey);
    const failed = await updateAgentVmRunForUser(ownerId, run.id, { status: "failed", errorMessage: message, completedAt: new Date() });
    return { configured: true as const, run: failed, plan: null, message };
  }
}
