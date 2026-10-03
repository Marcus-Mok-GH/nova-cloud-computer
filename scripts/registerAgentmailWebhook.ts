import { createAgentMailWebhook, isAgentMailConfigured } from "../server/agentmail";
import { ENV } from "../server/_core/env";

/**
 * Registers the AgentMail webhook that powers automatic email replies.
 *
 * AgentMail delivers a `message.received` event to
 * `${publicBaseUrl}/api/agentmail/webhook` whenever one of the workspace's
 * agent inboxes receives mail; the route verifies the Svix signature and then
 * runs the agent, which emails its answer back in the same thread.
 *
 * The signing secret is only returned by the create call, so this prints it
 * once - store it as AGENTMAIL_WEBHOOK_SECRET in the deployment's environment.
 * Running it again registers a second webhook (AgentMail has no upsert here),
 * so re-run only after deleting the old webhook in the AgentMail console.
 *
 * Requires AGENTMAIL_API_KEY and a resolvable public base URL
 * (NOVA_PUBLIC_BASE_URL / PUBLIC_BASE_URL / PUBLIC_APP_URL).
 */
async function main() {
  if (!isAgentMailConfigured()) {
    throw new Error("AGENTMAIL_API_KEY is not configured, so no webhook can be registered.");
  }
  const baseUrl = ENV.publicBaseUrl?.replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error(
      "No public base URL is configured, so AgentMail cannot reach the webhook. Set NOVA_PUBLIC_BASE_URL."
    );
  }
  const url = `${baseUrl}/api/agentmail/webhook`;
  const webhook = await createAgentMailWebhook({
    url,
    eventTypes: ["message.received"],
    clientId: "nova-agent-email-replies",
  });
  console.log(`Registered AgentMail webhook ${webhook.webhookId} -> ${url}`);
  console.log("Set this in the deployment environment (shown only once):");
  console.log(`AGENTMAIL_WEBHOOK_SECRET=${webhook.secret}`);
}

void main().catch(error => {
  console.error(
    "AgentMail webhook registration failed.",
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
