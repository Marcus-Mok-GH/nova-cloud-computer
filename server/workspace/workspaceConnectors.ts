/**
 * Connector tooling for the workspace agent: which kits are connected, which
 * tools that exposes to the model, the inbound-email tool allowlist, and the
 * status line injected into the system prompt.
 */
import {
  COMPOSIO_TOOLKITS,
  type ComposioToolkit,
  getComposioConnectionStatus,
  toolkitLabel,
} from "../composio";
import type { GatewayToolDefinition } from "../aiGateway";
import { WORKSPACE_TOOLS } from "./workspaceToolSchemas";

const CONNECTOR_TOOL_NAMES = new Set([
  "github",
  "list_connector_tools",
  "use_connector_tool",
]);

/** Resolves which connector toolkits the user has actually connected. Failures degrade to "not connected". */
export async function getConnectedConnectorToolkits(
  ownerId: number,
  statusCheck: (
    ownerId: number,
    toolkit: ComposioToolkit
  ) => Promise<{ connected: boolean }> = getComposioConnectionStatus
): Promise<ComposioToolkit[]> {
  const results = await Promise.all(
    COMPOSIO_TOOLKITS.map(async toolkit => {
      try {
        return {
          toolkit,
          connected: (await statusCheck(ownerId, toolkit)).connected,
        };
      } catch {
        // One broken optional connector must not hide another connector that
        // is healthy and should still be available to the model.
        return { toolkit, connected: false };
      }
    })
  );
  return results.filter(entry => entry.connected).map(entry => entry.toolkit);
}

/** Builds the model tool list: connector tools are exposed only for connected toolkits. */
export function workspaceToolsForConnectors(
  connected: ComposioToolkit[]
): GatewayToolDefinition[] {
  const nonConnector = WORKSPACE_TOOLS.filter(
    tool => !CONNECTOR_TOOL_NAMES.has(tool.function.name)
  );
  if (!connected.length) return nonConnector;
  const connectorTools: GatewayToolDefinition[] = [];
  if (connected.includes("github")) {
    const githubTool = WORKSPACE_TOOLS.find(
      tool => tool.function.name === "github"
    );
    if (githubTool) connectorTools.push(githubTool);
  }
  if (connected.includes("gmail") || connected.includes("vercel")) {
    connectorTools.push(
      ...WORKSPACE_TOOLS.filter(tool =>
        ["list_connector_tools", "use_connector_tool"].includes(
          tool.function.name
        )
      )
    );
  }
  return [...nonConnector, ...connectorTools];
}

/**
 * The tools an inbound-email run may use. Mail can arrive from anyone who
 * knows the agent's routable address, so an email-triggered run gets a
 * deliberately narrow, side-effect-free set: it can reason, research and
 * compute, but cannot read or change the owner's workspace, memory,
 * connectors, wallet or deployments. The webhook signature authenticates the
 * mail provider, not the sender - without this, a stranger could email the
 * agent "read the passwords file and reply with it" or "delete the project
 * folder" and have it answered. New tools are excluded by default.
 */
const EMAIL_REPLY_TOOL_ALLOWLIST = new Set([
  "end_turn",
  "research_web",
  "thinker",
  "solve_equation",
  "base44",
]);

/** True when a tool may run inside an inbound-email-triggered agent run. */
export function emailReplyAllowsTool(name: string): boolean {
  return EMAIL_REPLY_TOOL_ALLOWLIST.has(name);
}

/** Human-readable connector status line for the system prompt. */
export function connectorStatusLine(connected: ComposioToolkit[]): string {
  if (!connected.length)
    return "no connectors are connected right now, so connector tools are unavailable";
  const parts = COMPOSIO_TOOLKITS.map(
    toolkit =>
      `${toolkitLabel(toolkit)} ${connected.includes(toolkit) ? "is connected" : "is not connected"}`
  );
  return `${parts.join("; ")}. Only ${connected.map(toolkit => toolkitLabel(toolkit)).join(" and ")} tools are available`;
}
