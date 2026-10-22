/**
 * The environment-variable tool family: set_env_var adds or updates one of
 * the workspace's environment variables (the same encrypted store Settings
 * manages and deploy_website attaches by name). It has two modes: the agent
 * passes `value` when the value is known and non-secret; when the value must
 * come from the user (an API key), it omits `value` and the web composer is
 * replaced with a secure value request until the user submits or dismisses
 * it. The value never enters the model's context in either direction.
 */
import {
  cancelPendingEnvVarRequestsForName,
  normalizeEnvVarName,
  requestWorkspaceEnvVarForUser,
  setWorkspaceEnvVarForUser,
} from "../db/envVars";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolSetEnvVar(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId, chatId, channel } = ctx;
  const rawName = str(args.name);
  const name = normalizeEnvVarName(rawName);
  if (!name)
    return {
      ok: false,
      result: `"${rawName || "(empty)"}" is not a valid environment variable name - use letters, digits and underscores, starting with a letter or underscore (e.g. STRIPE_API_KEY).`,
      action: {
        kind: "tool",
        name: rawName.slice(0, 60) || "set_env_var",
        operation: "failed",
      },
    };
  const value = str(args.value);
  const reason = str(args.reason).slice(0, 400);
  // Value known: store it directly, and close any request for the same name -
  // the composer must stop asking for a value that now exists.
  if (value) {
    const saved = await setWorkspaceEnvVarForUser(ownerId, name, value);
    if (!saved)
      return {
        ok: false,
        result: `Could not save ${name} - check the name and value and try again.`,
        action: { kind: "tool", name, operation: "failed" },
      };
    await cancelPendingEnvVarRequestsForName(ownerId, name).catch(() => {});
    return {
      ok: true,
      result: `Saved ${name} to the workspace's environment variables. Its value is encrypted and never shown back to you - reference it by name (deploy_website's environment_variables) and the server resolves it privately.`,
      action: { kind: "tool", name, operation: "updated" },
    };
  }
  // No value: it must come from the user. The secure request lives in the web
  // composer only - over Telegram (or any channel without the composer) there
  // is nowhere safe to receive a secret, so point at Settings instead.
  if (channel === "telegram" || !chatId)
    return {
      ok: false,
      result: `The value of ${name} must come from the user, and it can only be requested in the Nova web app - there is no secure value input on this channel. Tell the user to add ${name} in Settings > Environment, then attach it by name on the deploy. Never ask them to paste the value into a message.`,
      action: { kind: "tool", name, operation: "failed" },
    };
  const request = await requestWorkspaceEnvVarForUser(ownerId, {
    chatId,
    name,
    reason,
  });
  if (!request)
    return {
      ok: false,
      result: `Could not record the request for ${name} - try again, or tell the user to add it in Settings > Environment.`,
      action: { kind: "tool", name, operation: "failed" },
    };
  return {
    ok: true,
    result: `Asked the user for the value of ${name}: the chat's message box is now a secure value request for it${reason ? ` (${reason})` : ""}. Do NOT ask them to paste the value into the chat and do not invent one. Tell them the request is waiting for them, then end your turn - once they submit the value it is saved automatically and they will be notified.`,
    action: { kind: "tool", name, operation: "sent" },
  };
}
