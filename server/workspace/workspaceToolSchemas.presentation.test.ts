import { describe, expect, it } from "vitest";
import { WORKSPACE_TOOLS } from "./workspaceToolSchemas";

const names = WORKSPACE_TOOLS.map(tool => tool.function.name);

describe("presentation tool schemas", () => {
  it("advertises generate, edit and export", () => {
    expect(names).toEqual(expect.arrayContaining([
      "generate_presentation",
      "edit_presentation",
      "export_presentation",
    ]));
  });

  it("asks for a design spec so each deck looks different", () => {
    const generate = WORKSPACE_TOOLS.find(t => t.function.name === "generate_presentation")!;
    expect(generate.function.description).toContain("unique");
    expect(generate.function.description).toContain("background");
    const edit = WORKSPACE_TOOLS.find(t => t.function.name === "edit_presentation")!;
    expect(edit.function.description).toContain("export_presentation");
  });
});
