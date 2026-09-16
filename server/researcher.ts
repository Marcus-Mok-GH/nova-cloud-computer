/** Nova's deep research delegate.
 *
 * The heavy lifting is done by Exa AI's deep research agent (the Exa Agent
 * API): a single call fans out into many live web searches, reads and
 * cross-checks the sources, and returns one grounded, cited report. Nova
 * frames the request and consumes the run's server-sent event stream — no
 * custom sub-agent loop or NVIDIA allowance is involved. */

import { ENV } from "./_core/env";
import { runExaAgentResearch, type ExaCitation } from "./exa";

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

/** Collects the unique citations from a run's grounding, preserving order. */
function collectSources(run: Awaited<ReturnType<typeof runExaAgentResearch>>): ExaCitation[] {
  const sources: ExaCitation[] = [];
  const seen = new Set<string>();
  for (const entry of run.output?.grounding ?? []) {
    for (const citation of entry.citations ?? []) {
      const url = citation.url?.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, title: citation.title?.trim() ?? "" });
    }
  }
  return sources;
}

/**
 * Runs Exa's deep research agent on a topic and returns its cited report.
 * @param topic The topic or question to research.
 * @param instructions Optional focus, constraints or specific questions.
 */
export async function runResearch(topic: string, instructions?: string): Promise<ResearchResult> {
  if (!ENV.exaApiKey.trim()) {
    throw new Error("Web research is not configured yet — the Nova operator needs to set EXA_API_KEY.");
  }

  const ask = `${topic.trim()}${
    instructions?.trim() ? `\n\nAdditional instructions: ${instructions.trim()}` : ""
  }`;
  const run = await runExaAgentResearch({
    query: ask,
    systemPrompt: RESEARCH_SYSTEM_PROMPT,
    effort: "medium",
  });
  const report = run.output?.text?.trim() ?? "";
  if (!report) throw new Error("Exa Agent finished the research without a report.");
  return { report, sources: collectSources(run) };
}
