/**
 * The workspace agent's personalisation tool family:
 * set_communication_style and set_personalisation. Called by the executor
 * with the per-call context built there.
 */
import {
  PERSONALISATION_DETAILS,
  PERSONALISATION_EXPERTISE,
  PERSONALISATION_PROACTIVENESS,
  setCommunicationStyleForUser,
  setPersonalisationForUser,
  type PersonalisationDetail,
  type PersonalisationExpertise,
  type PersonalisationInput,
  type PersonalisationProactiveness,
} from "../db";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolSetCommunicationStyle(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const style = (str(args.style) ?? "").trim();
  try {
    const saved = await setCommunicationStyleForUser(ownerId, style);
    return {
      ok: true,
      result: saved
        ? `Saved the user's preferred communication style: "${saved}" - follow it in every reply from now on, on every channel and in every chat.`
        : "Cleared the saved communication-style preference - your default style applies from now on.",
    };
  } catch (error) {
    return {
      ok: false,
      result: `Could not save the style preference: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function toolSetPersonalisation(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const input: PersonalisationInput = {};
  if (typeof args.enabled === "boolean") input.enabled = args.enabled;
  if (args.profile !== undefined) input.profile = str(args.profile) || null;
  if (args.tone !== undefined) input.tone = str(args.tone) || null;
  const detail = str(args.detail);
  if (args.detail !== undefined && (detail === "" || PERSONALISATION_DETAILS.includes(detail as PersonalisationDetail)))
    input.detail = detail === "" ? null : (detail as PersonalisationDetail);
  const proactiveness = str(args.proactiveness);
  if (args.proactiveness !== undefined && (proactiveness === "" || PERSONALISATION_PROACTIVENESS.includes(proactiveness as PersonalisationProactiveness)))
    input.proactiveness = proactiveness === "" ? null : (proactiveness as PersonalisationProactiveness);
  const expertise = str(args.expertise);
  if (args.expertise !== undefined && (expertise === "" || PERSONALISATION_EXPERTISE.includes(expertise as PersonalisationExpertise)))
    input.expertise = expertise === "" ? null : (expertise as PersonalisationExpertise);
  if (Object.keys(input).length === 0)
    return {
      ok: false,
      result:
        "No personalisation changes were provided. Pass at least one of enabled, profile, tone, detail, proactiveness or expertise.",
    };
  try {
    const saved = await setPersonalisationForUser(ownerId, input);
    const summary = [
      saved.profile ? `profile: "${saved.profile}"` : null,
      saved.tone ? `tone: ${saved.tone}` : null,
      saved.detail ? `detail: ${saved.detail}` : null,
      saved.proactiveness ? `proactiveness: ${saved.proactiveness}` : null,
      saved.expertise ? `expertise: ${saved.expertise}` : null,
    ].filter(Boolean).join(", ");
    return {
      ok: true,
      result: `Saved the user's personalisation preferences${summary ? ` (${summary})` : ""}.${saved.enabled ? " Personalisation mode is on - keep noticing and saving lasting preferences." : " Personalisation mode is off."}`,
    };
  } catch (error) {
    return {
      ok: false,
      result: `Could not save the personalisation preferences: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
