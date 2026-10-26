import type { SlashCommand } from "@shared/commands";

/**
 * The composer's slash menu: turning what the user has typed into the commands
 * worth offering. Kept free of React so the matching rules are unit-testable.
 */

/** The most suggestions the menu shows at once. */
export const MAX_SLASH_SUGGESTIONS = 6;

/**
 * The command being typed at the start of the composer text, or null when the
 * text is not a command in progress. Only a lone slash plus command characters
 * counts: typing a space ends the menu's turn, whether that space starts the
 * command's own argument or an ordinary message that merely begins with "/".
 */
export function slashCommandQuery(text: string): string | null {
  const match = /^\/([A-Za-z0-9-]*)$/.exec(text);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Scores a query as a subsequence of a target - every character of the query
 * must appear in order, not necessarily together, so "ulp" finds "ultraplan".
 * Matching characters score a point each, and two bonuses reward the hits that
 * make a match feel right: a character matching at the target's start, and a
 * character landing immediately after the previous one. Returns null when the
 * query is not a subsequence at all.
 */
function scoreSubsequence(query: string, target: string): number | null {
  let cursor = 0;
  let previousMatch = -2;
  let score = 0;
  for (const char of query) {
    const found = target.indexOf(char, cursor);
    if (found === -1) return null;
    score += 1;
    if (found === 0) score += 2;
    if (found === previousMatch + 1) score += 2;
    cursor = found + 1;
    previousMatch = found;
  }
  // A hair per extra character, so a shorter name wins an otherwise even tie.
  return score - target.length / 100;
}

/**
 * Scores one command against the query. The name is matched fuzzily and always
 * outranks the description, which is only searched for the query as plain text
 * - so a description can surface a command the user could not name, but can
 * never displace one they half-typed.
 */
function scoreCommand(query: string, command: SlashCommand): number | null {
  if (!query) return 0;
  const nameMatch = scoreSubsequence(
    query,
    command.name.slice(1).toLowerCase()
  );
  if (nameMatch !== null) return nameMatch + 100;
  return command.description.toLowerCase().includes(query) ? 1 : null;
}

/**
 * The commands matching what the user has typed, best match first and capped
 * at {@link MAX_SLASH_SUGGESTIONS}. An empty query matches everything in menu
 * order, which is what a bare "/" shows; equal scores keep that registry order.
 */
export function matchSlashCommands(
  commands: readonly SlashCommand[],
  query: string
): SlashCommand[] {
  const scored: Array<{ command: SlashCommand; score: number }> = [];
  for (const command of commands) {
    const score = scoreCommand(query, command);
    if (score !== null) scored.push({ command, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, MAX_SLASH_SUGGESTIONS)
    .map(entry => entry.command);
}

/**
 * The composer text a picked command fills in: its name, plus a trailing space
 * when it takes an argument so the caret lands ready for that argument.
 */
export function slashCommandInsertion(command: SlashCommand): string {
  return command.args ? `${command.name} ` : command.name;
}
