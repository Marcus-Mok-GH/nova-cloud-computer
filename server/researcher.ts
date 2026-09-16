/** Nova's deep research delegate.
 *
 * The heavy lifting is done by Exa AI's deep research models via the Deep
 * Search API: one request fans out into iterative live web searches, reads
 * and cross-checks the evidence, and returns one grounded, cited report. The
 * caller picks the research difficulty — the AI agent decides the level that
 * fits the question — and the chosen model ID is passed straight through. */

import { ENV } from "./_core/env";
import {
  normalizeExaDeepSearchType,
  runExaDeepResearch,
  type ExaCitation,
  type ExaDeepSearchType,
} from "./exa";

const RESEARCH_SYSTEM_PROMPT = `You are Nova's research specialist. You investigate topics on the live web and produce thorough, well-sourced research reports.

Write the final report as a structured research brief with:
- A short executive summary answering the topic directly.
- The findings, organized under clear headings.
- Inline citations in [1], [2] format for every factual claim, where the numbers map to the sources you actually used.
- A "Sources:" list at the end mapping every number to "Title — URL".
- Open questions and conflicting evidence, if any.

Rules:
- Only cite sources you actually found. Never invent sources, quotes, numbers or URLs.
- If evidence is thin, missing, or contradictory, say so plainly in the report.
- Keep the report focused and information-dense. No filler, no self-description.`;

export type ResearchResult = {
  report: string;
  sources: ExaCitation[];
};

/** The difficulty of a research run — Exa's deep research model IDs, shallowest to deepest. */
export type ResearchDifficulty = ExaDeepSearchType;

/**
 * Runs Exa deep research on a topic and returns its cited report.
 * @param topic The topic or question to research.
 * @param difficulty The research model / depth, always chosen by the calling
 *   AI agent after estimating what the question needs: "deep-lite" for
 *   single-fact lookups (~10 seconds), "deep" for medium multi-step research,
 *   "deep-reasoning" for the deepest research level. Anything unrecognised or
 *   missing falls back to "deep".
 * @param instructions Optional focus, constraints or specific questions.
 */
export async function runResearch(
  topic: string,
  difficulty?: string,
  instructions?: string,
): Promise<ResearchResult> {
  if (!ENV.exaApiKey.trim()) {
    throw new Error("Web research is not configured yet — the Nova operator needs to set EXA_API_KEY.");
  }

  const ask = `${topic.trim()}${
    instructions?.trim() ? `\n\nAdditional instructions: ${instructions.trim()}` : ""
  }`;
  const { report, sources } = await runExaDeepResearch({
    query: ask,
    type: normalizeExaDeepSearchType(difficulty),
    systemPrompt: RESEARCH_SYSTEM_PROMPT,
  });
  const trimmed = report.trim();
  if (!trimmed) throw new Error("The deep research run finished without a report.");
  return { report: trimmed, sources };
}
