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

  it("asks for a single preset theme instead of custom colours", () => {
    const generate = WORKSPACE_TOOLS.find(t => t.function.name === "generate_presentation")!;
    expect(generate.function.description).toContain("theme");
    expect(generate.function.description).toContain("background");
    expect(generate.function.description).toContain("hex");
    const design = (generate.function.parameters as {
      properties: { design: { properties: { theme: { enum: string[] } } } };
    }).properties.design;
    expect(design.properties.theme.enum).toHaveLength(9);
    const edit = WORKSPACE_TOOLS.find(t => t.function.name === "edit_presentation")!;
    expect(edit.function.description).toContain("export_presentation");
  });
});
