/**
 * Personalities: the named presets behind the composer's personality picker
 * (and the Personalisation section in Settings, which is the only place they
 * are created or edited).
 *
 * There is exactly one built-in personality - Default, Nova's own voice - and
 * it always exists. Every other personality belongs to the workspace and is
 * defined by the user. A personality is a saved bundle of the structured
 * personalisation controls, so selecting one in the composer is the same as
 * filling those controls in Settings; the server validates every field against
 * the unions here before saving.
 *
 * Shared so the picker and the server agree on the label/description copy and
 * on which fields a personality carries.
 */

/** Reply-length preference. Mirrors server/db/models.ts PERSONALISATION_DETAILS. */
export type PersonalityDetail = "brief" | "balanced" | "detailed";
/** Collaboration style. Mirrors PERSONALISATION_PROACTIVENESS. */
export type PersonalityCollaboration = "ask_first" | "act_and_tell" | "autonomous";
/** How much the user already knows. Mirrors PERSONALISATION_EXPERTISE. */
export type PersonalityExpertise = "new" | "some" | "expert";

export const PERSONALITY_DETAILS: PersonalityDetail[] = ["brief", "balanced", "detailed"];
export const PERSONALITY_COLLABORATIONS: PersonalityCollaboration[] = ["ask_first", "act_and_tell", "autonomous"];
export const PERSONALITY_EXPERTISES: PersonalityExpertise[] = ["new", "some", "expert"];

/** The Default personality's id. Never stored as a row: it is implicit. */
export const DEFAULT_PERSONALITY_ID = "default";

/** Longest name/instruction we accept; keeps the menu and prompt readable. */
export const PERSONALITY_NAME_MAX = 40;
export const PERSONALITY_INSTRUCTIONS_MAX = 600;

/**
 * A personality as the client sees it. `builtIn` rows are shipped with Nova
 * (currently only Default) and cannot be edited or deleted.
 */
export type Personality = {
  id: string;
  name: string;
  description: string;
  /** Free-form behaviour notes appended to the prompt verbatim. */
  instructions: string | null;
  detail: PersonalityDetail | null;
  collaboration: PersonalityCollaboration | null;
  expertise: PersonalityExpertise | null;
  builtIn: boolean;
};

/**
 * The one personality every workspace has. Nova's own voice: balanced length,
 * asks before assuming, no opinion on expertise.
 */
export const DEFAULT_PERSONALITY: Personality = {
  id: DEFAULT_PERSONALITY_ID,
  name: "Default",
  description: "Nova's own voice — balanced length, asks when unsure.",
  instructions: null,
  detail: null,
  collaboration: null,
  expertise: null,
  builtIn: true,
};

/** Human labels for the structured controls, shared by Settings and the menu. */
export const PERSONALITY_DETAIL_LABELS: Record<PersonalityDetail, string> = {
  brief: "Brief",
  balanced: "Balanced",
  detailed: "Detailed",
};

export const PERSONALITY_COLLABORATION_LABELS: Record<PersonalityCollaboration, string> = {
  ask_first: "Ask first",
  act_and_tell: "Act & tell",
  autonomous: "Autonomous",
};

export const PERSONALITY_EXPERTISE_LABELS: Record<PersonalityExpertise, string> = {
  new: "New to this",
  some: "Some experience",
  expert: "Expert",
};

/**
 * A compact, menu-sized summary of what a personality changes, e.g.
 * ["Brief", "Act & tell"]. Empty for Default (it changes nothing).
 */
export function personalityChips(personality: Personality): string[] {
  const chips: string[] = [];
  if (personality.detail) chips.push(PERSONALITY_DETAIL_LABELS[personality.detail]);
  if (personality.collaboration) chips.push(PERSONALITY_COLLABORATION_LABELS[personality.collaboration]);
  if (personality.expertise) chips.push(PERSONALITY_EXPERTISE_LABELS[personality.expertise]);
  return chips;
}

/** Narrow a stored string to a valid detail, or null. */
export function asPersonalityDetail(value: string | null | undefined): PersonalityDetail | null {
  return PERSONALITY_DETAILS.includes(value as PersonalityDetail) ? (value as PersonalityDetail) : null;
}
export function asPersonalityCollaboration(value: string | null | undefined): PersonalityCollaboration | null {
  return PERSONALITY_COLLABORATIONS.includes(value as PersonalityCollaboration)
    ? (value as PersonalityCollaboration)
    : null;
}
export function asPersonalityExpertise(value: string | null | undefined): PersonalityExpertise | null {
  return PERSONALITY_EXPERTISES.includes(value as PersonalityExpertise) ? (value as PersonalityExpertise) : null;
}