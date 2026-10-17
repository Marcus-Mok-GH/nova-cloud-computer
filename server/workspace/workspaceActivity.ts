/**
 * Per-tool-call presentation for the run loop: recovering tool calls the
 * model wrote out as text, unwrapping error chains into one diagnostic line,
 * and summarizing a settled call as the one-line activity label.
 */
import type { GatewayToolCall } from "../aiGateway";
import type { ToolExecution } from "./workspaceToolExecutor";

/**
 * Some models spell a tool call out as text instead of invoking it -
 * 'The function call that best answers the given prompt is {"name": "present_file", "parameters": {...}}'.
 * Recover the intent: extract the embedded JSON object and run it as a real
 * tool call so the action still executes and the raw JSON never reaches the user.
 */
export function toolCallWrittenAsText(
  text: string,
  tools: Array<{ function: { name: string } }>
): { name: string; arguments: string } | undefined {
  if (!text || !text.includes('"name"')) return undefined;
  const known = new Set(tools.map(tool => tool.function.name));
  for (const match of Array.from(
    text.matchAll(/"name"\s*:\s*"([A-Za-z0-9_]+)"/g)
  )) {
    const name = match[1];
    if (!known.has(name) || match.index === undefined) continue;
    const objectStart = text.lastIndexOf("{", match.index);
    if (objectStart < 0) continue;
    // Brace-match forward from the candidate start to the end of that object.
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = objectStart; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth !== 0) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(text.slice(objectStart, i + 1)) as Record<
            string,
            unknown
          >;
        } catch {
          break;
        }
        let parameters: Record<string, unknown>;
        if (typeof parsed.parameters === "object" && parsed.parameters !== null)
          parameters = parsed.parameters as Record<string, unknown>;
        else if (
          typeof parsed.arguments === "object" &&
          parsed.arguments !== null
        )
          parameters = parsed.arguments as Record<string, unknown>;
        else {
          const { name: _toolName, ...others } = parsed;
          parameters = others;
        }
        return { name, arguments: JSON.stringify(parameters) };
      }
    }
  }
  return undefined;
}

/**
 * Unwraps an error chain into one diagnostic line. Drizzle's query errors say
 * only "Failed query: <sql> params: ..." while the actual database error
 * (missing column, timeout, terminated connection) lives on `error.cause` -
 * without the cause, a failed query cannot be diagnosed from the chat.
 */
export function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    const message = current.message.trim();
    if (message && !parts.includes(message)) parts.push(message);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

export function toolSummary(call: GatewayToolCall, execution: ToolExecution) {
  const action = execution.action;
  if (!action) return call.name;
  if (action.kind === "tool")
    return `${action.operation === "failed" ? "Failed solving" : "Solved"}: ${action.name}.`;
  if (action.kind === "vm" && action.name === "bash")
    return `${action.operation === "failed" ? "Failed running" : "Ran"} a bash command in the sandbox.`;
  if (action.kind === "browser")
    return `${action.operation === "failed" ? "Failed running" : "Ran"} a browser command: ${action.name}.`;
  if (action.kind === "research")
    return `${action.operation === "failed" ? "Failed researching" : "Researched"}: ${action.name}.`;
  if (action.operation === "presented")
    return `Presented ${action.name} to the user.`;
  if (action.kind === "deployment")
    return action.operation === "failed"
      ? "Failed deploying the website."
      : `Deployed the website: ${action.name}.`;
  if (action.kind === "connector")
    return action.operation === "listed"
      ? `Listed ${action.name}.`
      : `${action.operation === "failed" ? "Failed running" : "Ran"} connector operation: ${action.name}.`;
  return `${action.operation === "deleted" ? "Delet" : action.operation === "updated" ? "Updat" : "Creat"}ed ${action.kind}: ${action.name}.`;
}
