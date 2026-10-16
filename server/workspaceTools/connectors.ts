/**
 * The workspace agent's connector tool family: the github tool and the
 * composio catalog/raw tools (Gmail, Vercel). Called by the executor with
 * the per-call context built there.
 */
import {
  ComposioApiError,
  GITHUB_OPERATIONS,
  executeComposioTool,
  executeGithubOperation,
  isComposioToolkit,
  isGithubOperation,
  listComposioTools,
  toolkitLabel,
} from "../composio";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolGithub(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const operation = str(args.operation);
  if (!isGithubOperation(operation))
    return {
      ok: false,
      result: `GitHub operation must be one of: ${GITHUB_OPERATIONS.join(", ")}.`,
      action: { kind: "connector", name: "GitHub", operation: "failed" },
    };
  try {
    const execution = await executeGithubOperation(
      ownerId,
      operation,
      args
    );
    const payload = JSON.stringify(execution.data, null, 2);
    const label = operation.replace(/_/g, " ");
    return {
      ok: execution.ok,
      result: execution.ok
        ? `GitHub ${label} succeeded.${payload && payload !== "null" ? `\nResult:\n${payload.slice(0, 4000)}` : ""}`
        : `GitHub ${label} failed: ${execution.error ?? "unknown error"}.`,
      detail: payload?.slice(0, 20_000),
      action: {
        kind: "connector",
        name: `GitHub: ${label}`,
        operation: execution.ok ? "executed" : "failed",
      },
    };
  } catch (error) {
    return {
      ok: false,
      result:
        error instanceof ComposioApiError
          ? error.message
          : `The GitHub request failed: ${str((error as Error)?.message)}.`,
      action: {
        kind: "connector",
        name: `GitHub: ${operation}`,
        operation: "failed",
      },
    };
  }
}

export async function toolListConnectorTools(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const connector = str(args.connector);
  if (!isComposioToolkit(connector) || (connector !== "gmail" && connector !== "vercel"))
    return {
      ok: false,
      result:
        "This catalog tool is only for Gmail and Vercel. Use the github tool for GitHub.",
    };
  const label = toolkitLabel(connector);
  const search = str(args.search) || undefined;
  const limitRaw = Number(args.limit);
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
  try {
    const { tools } = await listComposioTools(ownerId, connector, {
      search,
      limit,
    });
    if (!tools.length)
      return {
        ok: true,
        result: `No ${label} actions matched "${search ?? ""}". Try a broader search.`,
      };
    const lines = tools
      .map(tool => {
        const params = Object.entries(tool.inputParameters ?? {})
          .map(([name, schema]) => {
            const spec = schema as { type?: string; description?: string };
            return `${name}${spec?.type ? ` (${spec.type})` : ""}: ${spec?.description ?? ""}`;
          })
          .join("; ");
        return `${tool.slug} - ${tool.description}${params ? ` Parameters: ${params}` : ""}`;
      })
      .join("\n");
    return {
      ok: true,
      result: `${label} actions available:\n` + lines,
      action: {
        kind: "connector",
        name: `${tools.length} ${label} actions`,
        operation: "listed",
      },
    };
  } catch (error) {
    return {
      ok: false,
      result:
        error instanceof ComposioApiError
          ? error.message
          : `The connector catalog is unavailable: ${str((error as Error)?.message)}.`,
    };
  }
}

export async function toolUseConnectorTool(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const connector = str(args.connector);
  const action = str(args.action);
  const params = (args.params ?? {}) as Record<string, unknown>;
  if (!isComposioToolkit(connector) || (connector !== "gmail" && connector !== "vercel"))
    return {
      ok: false,
      result:
        "This raw action tool is only for Gmail and Vercel. Use the github tool for GitHub.",
    };
  if (!action) return { ok: false, result: "An action slug is required." };
  try {
    const execution = await executeComposioTool(
      ownerId,
      connector,
      action,
      params
    );
    const label = toolkitLabel(connector);
    const payload = JSON.stringify(execution.data, null, 2);
    return {
      ok: execution.ok,
      result: execution.ok
        ? `${label} action ${action} succeeded.${payload && payload !== "null" ? `\nResult:\n${payload.slice(0, 4000)}` : ""}`
        : `${label} action ${action} failed: ${execution.error ?? "unknown error"}. Check the parameters with list_connector_tools and retry.`,
      action: { kind: "connector", name: action, operation: "executed" },
    };
  } catch (error) {
    return {
      ok: false,
      result:
        error instanceof ComposioApiError
          ? error.message
          : `The connector request failed: ${str((error as Error)?.message)}.`,
      action: { kind: "connector", name: action, operation: "failed" },
    };
  }
}
