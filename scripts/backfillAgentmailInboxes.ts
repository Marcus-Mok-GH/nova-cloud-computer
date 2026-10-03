import { backfillAgentMailInboxes } from "../server/agents";

/**
 * One-time repair utility for agents created before AgentMail was wired up: it
 * provisions a real AgentMail inbox for each agent that does not have one, so
 * the fake `@nova.local` alias is replaced by a routable `@agentmail.to`
 * address in the UI, in the agent's prompt, and in outbound mail.
 *
 * Safe to rerun: only agents without a recorded inbox are selected.
 * Requires DATABASE_URL (the target database) and AGENTMAIL_API_KEY.
 */
async function main() {
  const summary = await backfillAgentMailInboxes();
  console.log(
    `AgentMail inbox backfill finished: ${summary.provisioned} provisioned, ${summary.failed} failed, ${summary.examined} examined.`
  );
  if (summary.failed) process.exitCode = 1;
}

void main().catch(error => {
  console.error(
    "AgentMail inbox backfill failed.",
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
