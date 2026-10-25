/**
 * The slash commands a conversation understands. The web composer lists them
 * in its slash menu and inserts a command's exact spelling, while the server
 * parses the same spelling off the front of a message - so the names live here,
 * in one place, and the menu can never offer a command the agent does not
 * recognize (or misspell the ones it does).
 */

/** The `/ultraplan` command: plan a task deeply, then wait for approval. */
export const ULTRAPLAN_COMMAND = "/ultraplan";

/** The `/goal` command: chase an outcome autonomously until it is met. */
export const GOAL_COMMAND = "/goal";

export interface SlashCommand {
  /** The command as typed, including its leading slash. */
  name: string;
  /**
   * The argument placeholder shown after the name in the menu, or "" for a
   * command that takes no argument.
   */
  args: string;
  /** One line explaining what the command does, shown beside its name. */
  description: string;
}

/** Every command the composer offers, in menu order. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: ULTRAPLAN_COMMAND,
    args: "<task>",
    description:
      "Research the task and draft a plan for your approval before anything changes",
  },
  {
    name: GOAL_COMMAND,
    args: "<objective>",
    description:
      "Work toward an outcome on your own, round after round, until it is met",
  },
];
