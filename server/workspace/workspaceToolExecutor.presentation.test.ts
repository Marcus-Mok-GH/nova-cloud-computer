import { describe, expect, it, vi } from "vitest";

vi.mock("../workspaceTools/presentation", () => ({
  toolGeneratePresentation: vi.fn(async () => ({ ok: true, result: "generated" })),
  toolEditPresentation: vi.fn(async () => ({ ok: true, result: "edited" })),
  toolExportPresentation: vi.fn(async () => ({ ok: true, result: "exported" })),
}));

import {
  toolEditPresentation,
  toolExportPresentation,
  toolGeneratePresentation,
} from "../workspaceTools/presentation";
import { executeWorkspaceTool } from "./workspaceToolExecutor";

const call = (name: string) =>
  executeWorkspaceTool(
    7,
    { folders: [], files: [] } as never,
    { id: "c1", name, arguments: JSON.stringify({ title: "Deck" }) } as never
  );

describe("presentation tool routing", () => {
  it("dispatches all three presentation tools", async () => {
    expect((await call("generate_presentation")).result).toBe("generated");
    expect((await call("edit_presentation")).result).toBe("edited");
    expect((await call("export_presentation")).result).toBe("exported");
    expect(toolGeneratePresentation).toHaveBeenCalledTimes(1);
    expect(toolEditPresentation).toHaveBeenCalledTimes(1);
    expect(toolExportPresentation).toHaveBeenCalledTimes(1);
  });
});
