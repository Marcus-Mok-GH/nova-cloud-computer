/**
 * The solver tool family: solve_equation, a pure mathjs evaluation with no
 * workspace side effects.
 */
import { evaluate } from "mathjs";
import { type ToolCtx, type ToolExecution } from "./types";

/** Formats a numeric mathjs result for the agent: clean integers, readable decimals. */
function formatMathAnswer(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Round long floats to 6 decimal places, trimming trailing zeros.
  return String(Math.round(value * 1e6) / 1e6);
}

export async function toolSolveEquation(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str } = ctx;
  const equation = str(args.equation).trim();
  if (!equation)
    return { ok: false, result: "An equation to solve is required." };
  try {
    const answer = evaluate(equation);
    if (
      answer === undefined ||
      answer === null ||
      (typeof answer === "number" && !Number.isFinite(answer))
    ) {
      const noNumber = `That expression does not evaluate to a number (got: ${String(answer)}). Pass a single numeric expression like '20 - 11.33'.`;
      return {
        ok: false,
        result: noNumber,
        detail: noNumber,
        action: {
          kind: "tool",
          name: equation.slice(0, 60),
          operation: "failed",
        },
      };
    }
    const formatted =
      typeof answer === "number" ? formatMathAnswer(answer) : String(answer);
    return {
      ok: true,
      result: `${equation} = ${formatted}`,
      detail: `${equation} = ${formatted}`,
      action: {
        kind: "tool",
        name: equation.slice(0, 60),
        operation: "completed",
      },
    };
  } catch (error) {
    const failure = `Could not evaluate '${equation}': ${error instanceof Error ? error.message : "invalid expression"}. Pass a single numeric expression like '20 - 11.33' or 'sqrt(196) * 3.5'.`;
    return {
      ok: false,
      result: failure,
      detail: failure,
      action: {
        kind: "tool",
        name: equation.slice(0, 60),
        operation: "failed",
      },
    };
  }
}
