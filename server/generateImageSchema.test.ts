/**
 * The built-in image model must be reachable by the main agent: the tool is
 * part of the workspace toolkit the model is offered, and - because it talks to
 * a remote provider and writes only the durable store - it is not one of the
 * tools that forces a sandbox wake.
 */
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOOLS } from "./workspace/workspaceToolSchemas";
import { toolNeedsSandbox } from "./workspace/workspaceToolExecutor";

describe("generate_image tool exposure", () => {
  const tool = WORKSPACE_TOOLS.find(
    entry => entry.function.name === "generate_image"
  );

  it("is offered to the model with its prompt and aspect-ratio parameters", () => {
    expect(tool).toBeDefined();
    const definition = tool?.function;
    expect(definition?.description).toContain("Pollinations Flux 2 Dev");
    expect(definition?.parameters).toMatchObject({
      type: "object",
      properties: {
        prompt: { type: "string" },
        aspect_ratio: { type: "string", enum: ["square", "landscape", "portrait"] },
      },
      required: ["prompt"],
    });
  });

  it("does not wake a workspace sandbox", () => {
    expect(toolNeedsSandbox("generate_image")).toBe(false);
  });
});
