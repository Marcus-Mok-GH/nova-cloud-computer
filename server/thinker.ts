/** Nova's thinking specialist delegate.
 *
 * The heavy lifting is done by a frontier reasoning model served through
 * NVIDIA NIM (https://build.nvidia.com). The calling agent - Nova's main
 * model - is a fast supervisor that routes and verifies; when a problem
 * needs sustained reasoning rather than lookup or computation (a design or
 * strategy decision, a multi-step plan, a subtle trade-off, or a review of
 * its own reasoning), it delegates the question here. The thinker returns a
 * long, detailed account of what it found: the reasoning, the trade-offs,
 * the risks, and what is verified versus inferred. It reasons only - it has
 * no tools and never acts on the workspace. */

import { ENV } from "./_core/env";
import { isNimConfigured, NimConfigError, runNimChat } from "./nim";

const THINKER_SYSTEM_PROMPT = `You are Nova's thinking specialist - the deeper reasoning model the main agent consults when a problem is too hard to resolve confidently on its own. It hands you a question, a plan, a design decision, or a body of material; your job is to think it through thoroughly and return a long, detailed account of what you find.

Method:
- Restate the real question in one line first, so the caller can confirm you understood it.
- Work through the problem step by step: break it into its parts, examine each one, weigh the competing options, and follow the reasoning to its consequences.
- Ground every claim. State plainly what is verified, what is inferred, and what is unknown or uncertain. When the material is insufficient to decide, say exactly what is missing instead of guessing.
- Surface the important edge cases, risks, failure modes, and second-order effects the caller is likely to miss.
- When more than one answer is defensible, lay out the leading options with their trade-offs, give a clear recommendation, and say what evidence would change it.

Output:
- A detailed written analysis, not a terse answer. Use short headings to separate the parts.
- Be information-dense: every paragraph must carry reasoning or findings - no filler, no restating the question, no self-description.
- Let length follow the difficulty of the question: a genuinely hard problem earns a thorough multi-section analysis, while a simple one is answered precisely and then stops.`;

export type ThinkerResult = {
  /** The specialist's complete analysis: findings, reasoning and conclusions. */
  analysis: string;
  /** The NIM model ID that produced the analysis. */
  model: string;
};

/**
 * Delegates one hard reasoning task to the thinker and returns its complete
 * analysis.
 * @param question The question or problem to think through, described
 *   completely, including what a good answer needs to resolve.
 * @param context Optional supporting material - the code, data, constraints,
 *   prior reasoning or conversation state the question depends on.
 * Rejects when the task is empty or NVIDIA NIM is not configured (the
 * operator must set NVIDIA_NIM_API_KEY).
 */
export async function runThinkerTask(
  question: string,
  context?: string
): Promise<ThinkerResult> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error("A thinking task is required.");
  if (!isNimConfigured()) {
    throw new NimConfigError(
      "The thinker sub-agent is not configured on this workspace - the workspace owner must finish setting it up."
    );
  }

  const parts: string[] = [`Question to think through:\n\n${trimmed}`];
  if (context?.trim())
    parts.push(`Context and material:\n\n${context.trim()}`);
  const analysis = await runNimChat({
    prompt: parts.join("\n\n"),
    systemPrompt: THINKER_SYSTEM_PROMPT,
    model: ENV.nimThinkerModel,
  });
  return { analysis: analysis.trim(), model: ENV.nimThinkerModel };
}
