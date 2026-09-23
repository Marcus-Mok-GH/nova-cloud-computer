import { describe, expect, it } from "vitest";
import { buildAutonomousMissionPrompt } from "./autonomousMission";

describe("buildAutonomousMissionPrompt", () => {
  it("turns a recurring automation into an observe-act-verify mission", () => {
    const prompt = buildAutonomousMissionPrompt({
      name: "Keep the project tidy",
      instructions: "Review the workspace weekly and keep the project notes current.",
      executionPrompt: "Inspect project notes and update stale sections.",
      args: { folder: "notes" },
      definition: { constraints: { requiresApproval: false } },
      now: new Date("2026-09-23T00:00:00.000Z"),
      previousRunAt: new Date("2026-09-22T00:00:00.000Z"),
    });

    expect(prompt).toContain("Observe: inspect");
    expect(prompt).toContain("Act: use Nova workspace tools");
    expect(prompt).toContain("Verify: read back");
    expect(prompt).toContain("Keep the project tidy");
    expect(prompt).toContain("Last run: 2026-09-22T00:00:00.000Z");
    expect(prompt).toContain("requiresApproval");
  });
});
