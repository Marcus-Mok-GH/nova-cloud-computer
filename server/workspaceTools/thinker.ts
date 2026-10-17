/**
 * The thinker sub-agent tool family: one long model call that reasons through
 * a question, with a quiet-stream heartbeat so the activity panel stays honest.
 */
import { runThinkerTask } from "../thinker";
import { NimConfigError } from "../nim";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolThinker(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, onProgress } = ctx;
  const question = str(args.question).trim();
  if (!question)
    return { ok: false, result: "A question to think through is required." };
  const context = str(args.context) || undefined;
  const startedAt = Date.now();
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
        onProgress(
          `The thinker sub-agent is still reasoning - ${elapsed}s elapsed…`
        );
      }, 10000)
    : undefined;
  note("The thinker sub-agent is reasoning through the question…");
  try {
    const thought = await runThinkerTask(question, context);
    return {
      ok: true,
      result: thought.analysis,
      detail: thought.analysis.slice(0, 16000),
      action: {
        kind: "tool",
        name: `thinker: ${question.slice(0, 45)}`,
        operation: "completed",
      },
    };
  } catch (error) {
    // Config problems (missing key, missing model ID for a custom
    // endpoint) already carry a clean, user-facing explanation.
    const message =
      error instanceof NimConfigError
        ? error.message
        : `The thinker sub-agent failed: ${
            error instanceof Error ? error.message : "unknown error"
          }.`;
    return {
      ok: false,
      result: message,
      detail: message,
      action: {
        kind: "tool",
        name: `thinker: ${question.slice(0, 45)}`,
        operation: "failed",
      },
    };
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
}
