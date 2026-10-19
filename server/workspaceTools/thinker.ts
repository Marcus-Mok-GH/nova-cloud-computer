/**
 * The thinker sub-agent tool family: one long model call that reasons through
 * a question, with a quiet-stream heartbeat so the activity panel stays honest.
 */
import { errorMessage } from "@shared/_core/errors";
import { runThinkerTask } from "../thinker";
import { NimConfigError } from "../nim";
import { createProgressNudge } from "./progress";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolThinker(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, onProgress } = ctx;
  const question = str(args.question).trim();
  if (!question)
    return { ok: false, result: "A question to think through is required." };
  const context = str(args.context) || undefined;
  const startedAt = Date.now();
  const nudge = createProgressNudge({
    onProgress,
    startedAt,
    stillWorking: elapsed =>
      `The thinker sub-agent is still reasoning - ${elapsed}s elapsed…`,
  });
  const note = nudge.note;
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
        : `The thinker sub-agent failed: ${errorMessage(error, "unknown error")}.`;
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
    nudge.stop();
  }
}
