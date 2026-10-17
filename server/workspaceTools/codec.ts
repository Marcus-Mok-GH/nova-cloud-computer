/**
 * The codec tool family: base44 encode/decode, a pure text transform with no
 * workspace side effects.
 */
import { decodeBase44Text, encodeBase44Text } from "../base44";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolBase44(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str } = ctx;
  const operation = str(args.operation);
  if (operation !== "encode" && operation !== "decode")
    return {
      ok: false,
      result: "Base44 operation must be either encode or decode.",
      action: { kind: "tool", name: "base44", operation: "failed" },
    };
  if (typeof args.value !== "string")
    return {
      ok: false,
      result: "A value is required for Base44 encoding or decoding.",
      action: {
        kind: "tool",
        name: `base44 ${operation}`,
        operation: "failed",
      },
    };
  try {
    const value = args.value;
    const result =
      operation === "encode"
        ? encodeBase44Text(value)
        : decodeBase44Text(value);
    return {
      ok: true,
      result,
      detail: result,
      action: {
        kind: "tool",
        name: `base44 ${operation}`,
        operation: "completed",
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid Base44 value";
    return {
      ok: false,
      result: `Base44 ${operation} failed: ${message}.`,
      action: {
        kind: "tool",
        name: `base44 ${operation}`,
        operation: "failed",
      },
    };
  }
}
