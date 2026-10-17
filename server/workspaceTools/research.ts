/**
 * The research sub-agent tool family: research_web. Streams its real process
 * through the run's progress callback and reports web sources as structured
 * citations.
 */
import { runResearch } from "../researcher";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolResearchWeb(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, onProgress } = ctx;
  const topic = str(args.topic);
  if (!topic) return { ok: false, result: "A research topic is required." };
  const difficulty = str(args.difficulty) || undefined;
  const instructions = str(args.instructions) || undefined;
  const startedAt = Date.now();
  // The researcher streams its real process now (sub-search results, the
  // start of report synthesis). The elapsed-time heartbeat only fires
  // when the stream has gone quiet, so the log shows work, not ticking.
  let lastNoteAt = Date.now();
  const note = (detail: string) => {
    lastNoteAt = Date.now();
    onProgress?.(detail);
  };
  const progressTimer = onProgress
    ? setInterval(() => {
        if (Date.now() - lastNoteAt < 25_000) return;
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        lastNoteAt = Date.now();
        onProgress(`Deep research is still working - ${elapsed}s elapsed…`);
      }, 10000)
    : undefined;
  note(`Deep research is starting its web searches…`);
  try {
    const research = await runResearch(topic, difficulty, instructions, note);
    const sourcesBlock = research.sources.length
      ? `\n\nAll sources consulted by the researcher:\n${research.sources
          .map(
            (source, index) =>
              `${index + 1}. ${source.title || source.url} - ${source.url}`
          )
          .join("\n")}`
      : "";
    return {
      ok: true,
      result: research.report + sourcesBlock,
      detail: research.report + sourcesBlock,
      citations: research.sources,
      action: {
        kind: "research",
        name: topic.slice(0, 60),
        operation: "completed",
      },
    };
  } catch (error) {
    const message = `Web research failed: ${error instanceof Error ? error.message : "unknown error"}.`;
    return {
      ok: false,
      result: message,
      detail: message,
      action: {
        kind: "research",
        name: topic.slice(0, 60),
        operation: "failed",
      },
    };
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
}
