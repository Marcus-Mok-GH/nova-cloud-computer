/** Nova's researcher sub-agent.
 *
 * A dedicated LLM loop with one tool — live web search via Exa AI. The main
 * workspace agent delegates a topic with the research_web tool; this
 * sub-agent plans and runs multiple targeted searches, cross-reads the
 * results, and writes a full research report with inline citations and a
 * numbered source list. The report is returned verbatim to the main agent.
 *
 * The sub-agent is fully autonomous: it keeps searching until it decides the
 * evidence is complete, bounded only by the workspace's NVIDIA request
 * allowance (the gateway refuses calls once the allowance is exhausted). */

import { ENV } from "./_core/env";
import {
  chatWithNvidiaGateway,
  type GatewayChatMessage,
  type GatewayToolDefinition,
  type GatewayToolCall,
} from "./nvidiaGateway";
import { searchExa, type ExaSearchResult } from "./exa";

const RESEARCHER_TOOLS: GatewayToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "Search the live web with Exa AI. Returns results with title, URL, published date and a text excerpt of each page. Run several targeted searches with different phrasings and angles before writing your report.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A specific, targeted search query." },
          num_results: { type: "number", description: "How many results to return (default 5, max 8)." },
        },
        required: ["query"],
      },
    },
  },
];

const RESEARCHER_SYSTEM_PROMPT = `You are Nova's research specialist. You investigate topics on the live web and produce thorough, well-sourced research reports.

How you work:
1. Plan your searches first: break the topic into the distinct questions a complete answer needs.
2. Call search_web as many times as the topic genuinely needs — different phrasings, different angles, follow-ups on leads. Prefer recent and primary sources. You are the judge of when the evidence is complete: keep searching while it materially improves the report, then write it.
3. Write the final report — a structured research brief with:
   - A short executive summary answering the topic directly.
   - The findings, organized under clear headings.
   - Inline citations in [1], [2] format for every factual claim.
   - A "Sources:" list at the end mapping every number to "Title — URL".
   - Open questions and conflicting evidence, if any.

Rules:
- Only cite sources you actually found with search_web. Never invent sources, quotes, numbers or URLs.
- If evidence is thin, missing, or contradictory, say so plainly in the report.
- Keep the report focused and information-dense. No filler, no self-description.`;

export type ResearchResult = {
  report: string;
  sources: ExaSearchResult[];
};

/** Parses the arguments of a raw gateway tool call. */
function parseToolArgs(call: GatewayToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.arguments || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Formats Exa results as a numbered tool response the model can cite. */
function formatSearchResponse(results: ExaSearchResult[]): string {
  if (!results.length) return "No results found for that query. Try different phrasing.";
  return results
    .map(
      (result, index) =>
        `[${index + 1}] ${result.title}${result.publishedDate ? ` (${result.publishedDate})` : ""}\nURL: ${result.url}\n${result.text}`
    )
    .join("\n\n");
}

/**
 * Runs the researcher sub-agent on a topic.
 * @param ownerId Workspace owner — the research runs on their NVIDIA allowance.
 * @param topic The topic or question to research.
 * @param instructions Optional focus, constraints or specific questions.
 */
export async function runResearch(
  ownerId: number,
  topic: string,
  instructions?: string
): Promise<ResearchResult> {
  if (!ENV.exaApiKey.trim()) {
    throw new Error("Web research is not configured yet — the Nova operator needs to set EXA_API_KEY.");
  }

  const ask = `Research topic: ${topic.trim()}${
    instructions?.trim() ? `\n\nAdditional instructions: ${instructions.trim()}` : ""
  }\n\nResearch this thoroughly with search_web, then write your final cited report.`;

  const messages: GatewayChatMessage[] = [
    { role: "system", content: RESEARCHER_SYSTEM_PROMPT },
    { role: "user", content: ask },
  ];
  const sources: ExaSearchResult[] = [];

  const searchRound = async () => {
    const result = await chatWithNvidiaGateway(ownerId, messages, { tools: RESEARCHER_TOOLS });
    messages.push({
      role: "assistant",
      content: result.text || null,
      tool_calls: result.toolCalls.map(call => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    for (const call of result.toolCalls) {
      let content: string;
      if (call.name === "search_web") {
        const args = parseToolArgs(call);
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) {
          content = "A search query is required.";
        } else {
          try {
            const numResults = Number(args.num_results) || 5;
            const results = await searchExa(query, numResults);
            sources.push(...results);
            content = formatSearchResponse(results);
          } catch (error) {
            content = `Search failed: ${error instanceof Error ? error.message : "unknown error"}. Try again with a different query.`;
          }
        }
      } else {
        content = "Unknown tool. Only search_web is available.";
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
    return result;
  };

  // Fully autonomous: the researcher keeps searching until it decides the
  // evidence is complete and writes its final cited report. The workspace's
  // NVIDIA request allowance is the natural bound — the gateway refuses
  // further calls once it is exhausted.
  for (;;) {
    const result = await searchRound();
    if (!result.toolCalls.length) return { report: result.text.trim(), sources };
  }
}
