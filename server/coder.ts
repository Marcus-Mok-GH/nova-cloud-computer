/** Nova's coding specialist delegate.
 *
 * The heavy lifting is done by the strongest coding model served through
 * NVIDIA NIM (https://build.nvidia.com) - Kimi K3 by default, a
 * frontier coding MoE with a 262K-token context. The calling agent
 * describes the coding task and supplies any existing code or errors as
 * context; the specialist returns complete, working code the agent then
 * places into the workspace with its file tools. */

import { ENV } from "./_core/env";
import { runNimChat } from "./nim";

const CODER_SYSTEM_PROMPT = `You are Nova's coding specialist. You write, refactor, debug, and optimize real code for Nova's users.

Rules:
- Return complete, working code - full files or full functions, never "..." placeholders or instructions to imagine the rest.
- Match the language, framework, and style the task asks for; when the task includes existing code, extend or fix it in place without gratuitous rewrites.
- Prefer clarity over cleverness. Handle the obvious edge cases; comment only what is genuinely non-obvious.
- When the request is ambiguous, make the most reasonable choice and note the assumption in one short comment - do not stall with questions.
- You may add a brief explanation before or after the code (a few sentences at most), but the code is the deliverable: no filler, no self-description, no apologies.
- If the task is impossible as stated (contradictory requirements, missing dependency that cannot be assumed), return the closest workable version and say in one line what you changed.`;

export type CoderResult = {
  /** The specialist's complete reply: the working code plus its brief explanation. */
  code: string;
  /** The NIM model ID that produced the reply. */
  model: string;
};

/**
 * Delegates one coding task to the specialist and returns its complete
 * reply. @param task The coding job, described completely: goal, language,
 * constraints, what "done" means. @param context Optional supporting
 * material - existing code, the exact error output, file layouts. @param
 * language Optional explicit target language or framework. Rejects when
 * the task is empty or NVIDIA NIM is not configured (the operator must set
 * NVIDIA_NIM_API_KEY).
 */
export async function runCoderTask(
  task: string,
  context?: string,
  language?: string,
): Promise<CoderResult> {
  const trimmedTask = task.trim();
  if (!trimmedTask) throw new Error("A coding task is required.");

  const parts: string[] = [];
  if (language?.trim()) parts.push(`Target language/framework: ${language.trim()}`);
  parts.push(`Coding task:\n\n${trimmedTask}`);
  if (context?.trim()) parts.push(`Existing code, errors, and other context:\n\n${context.trim()}`);
  const code = await runNimChat({ prompt: parts.join("\n\n"), systemPrompt: CODER_SYSTEM_PROMPT });
  return { code: code.trim(), model: ENV.nimCoderModel };
}
