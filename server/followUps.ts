/**
 * Suggested follow-ups: the `follow_up` tool lets the agent propose up to
 * three next actions for the user, and the run persists them beneath the
 * closing reply as an internal ledger row. The web client reads that row and
 * renders the suggestions as tappable chips; the raw row is never shown as
 * chat text and never reaches the model's conversation history.
 *
 * The parsing and normalization live in `@shared/followUps` next to the
 * marker the rows start with, so both sides keep identical semantics from a
 * single definition. The names are re-exported here for the server callers.
 */

export { FOLLOW_UP_MESSAGE_PREFIX } from "@shared/const";
export {
  MAX_FOLLOW_UPS,
  normalizeFollowUps,
  buildFollowUpMessage,
  parseFollowUpMessage,
} from "@shared/followUps";
