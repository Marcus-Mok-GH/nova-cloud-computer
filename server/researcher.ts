/** Nova's researcher sub-agent.
 *
 * A dedicated LLM loop with one tool — live web search via Exa AI. The main
 * workspace agent delegates a topic with the research_web tool; this
 * sub-agent plans and runs multiple targeted searches, cross-reads the
 * results, and writes a full research report with inline citations and a
 * numbered source list. The report is returned verbatim to the main agent.
 *
 * Every gateway call spends one request of the workspace's NVIDIA allowance,
 * so the loop is capped at MAX_RESEARCH_ROUNDS. */

import { ENV } from "./_core/env";
import {
  chatWithNvidiaGateway,
  type GatewayChatMessage,
  type GatewayToolDefinition,
  type GatewayToolCall,
} from "./nvidiaGateway";
import { searchExa, type ExaSearchResult } from "./exa";

/** Gateway calls allowed per research run (search rounds + final report). */
export const MAX_RESEARCH_ROUNDS = 6;

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
2. Call search_web several times with different, targeted queries until you have enough cross-checked evidence. Prefer recent and primary sources.
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

  for (let round = 0; round < MAX_RESEARCH_ROUNDS - 1; round += 1) {
    const result = await searchRound();
    if (!result.toolCalls.length) return { report: result.text.trim(), sources };
  }

  // The researcher kept searching past the cap — force a final report from
  // what it has gathered so far.
  messages.push({
    role: "user",
    content:
      "You have reached your search budget. Write your complete final report now, using only the sources you have gathered. Include the inline citations and the Sources list.",
  });
  const final = await chatWithNvidiaGateway(ownerId, messages, {});
  return { report: final.text.trim(), sources };
}
