import { describe, expect, it } from "vitest";
import type { SlashCommand } from "@shared/commands";
import {
  MAX_SLASH_SUGGESTIONS,
  matchSlashCommands,
  slashCommandInsertion,
  slashCommandQuery,
} from "./slashCommands";

const command = (
  name: string,
  description = "does something",
  args = ""
): SlashCommand => ({ name, args, description });

describe("slashCommandQuery", () => {
  it("returns an empty query for a bare slash", () => {
    expect(slashCommandQuery("/")).toBe("");
  });

  it("returns the command characters being typed, lowercased", () => {
    expect(slashCommandQuery("/ultraplan")).toBe("ultraplan");
    expect(slashCommandQuery("/Ultra")).toBe("ultra");
    expect(slashCommandQuery("/v2-beta")).toBe("v2-beta");
  });

  it("stops being a command once a space is typed", () => {
    // The message is no longer a command in progress: it either carries the
    // command's argument or is just prose that happens to start with a slash.
    expect(slashCommandQuery("/ultraplan add a login page")).toBeNull();
    expect(slashCommandQuery("/ultraplan ")).toBeNull();
  });

  it("ignores text that is not a command at all", () => {
    expect(slashCommandQuery("")).toBeNull();
    expect(slashCommandQuery("hello")).toBeNull();
    expect(slashCommandQuery(" /ultraplan")).toBeNull();
    expect(slashCommandQuery("see /docs")).toBeNull();
    expect(slashCommandQuery("/ultra/plan")).toBeNull();
    expect(slashCommandQuery("/ultra plan")).toBeNull();
  });
});

describe("matchSlashCommands", () => {
  it("offers every command, in order, for a bare slash", () => {
    const commands = [command("/alpha"), command("/beta")];
    expect(matchSlashCommands(commands, "")).toEqual(commands);
  });

  it("matches a typed prefix", () => {
    const commands = [command("/alpha"), command("/beta")];
    expect(matchSlashCommands(commands, "al")).toEqual([commands[0]]);
  });

  it("matches scattered characters as a subsequence", () => {
    const commands = [command("/ultraplan")];
    expect(matchSlashCommands(commands, "ulp")).toEqual(commands);
    expect(matchSlashCommands(commands, "utn")).toEqual(commands);
  });

  it("drops commands the query cannot match", () => {
    expect(matchSlashCommands([command("/ultraplan")], "zzz")).toEqual([]);
    // Order matters for a subsequence: "napl" is not in "ultraplan".
    expect(matchSlashCommands([command("/ultraplan")], "napl")).toEqual([]);
  });

  it("ranks a name match above a description match", () => {
    const described = command("/beta", "plan the work");
    const named = command("/plan");
    const matches = matchSlashCommands([described, named], "plan");
    expect(matches).toEqual([named, described]);
  });

  it("finds a command by its description when the name is not known", () => {
    const commands = [command("/alpha"), command("/beta", "draft a plan")];
    expect(matchSlashCommands(commands, "draft")).toEqual([commands[1]]);
  });

  it("prefers a tighter run of matched characters", () => {
    const scattered = command("/p-l-a-n");
    const together = command("/plan");
    expect(matchSlashCommands([scattered, together], "plan")[0]).toBe(together);
  });

  it("caps how many suggestions it offers", () => {
    const commands = Array.from({ length: MAX_SLASH_SUGGESTIONS + 4 }, (_, i) =>
      command(`/cmd${i}`)
    );
    expect(matchSlashCommands(commands, "cmd")).toHaveLength(
      MAX_SLASH_SUGGESTIONS
    );
  });
});

describe("slashCommandInsertion", () => {
  it("leaves the caret ready for a command's argument", () => {
    expect(
      slashCommandInsertion(command("/ultraplan", "plans", "<task>"))
    ).toBe("/ultraplan ");
  });

  it("adds no trailing space to a command that takes no argument", () => {
    expect(slashCommandInsertion(command("/stop"))).toBe("/stop");
  });
});
