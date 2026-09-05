import { Sandbox } from "e2b";
import { describe, expect, it } from "vitest";

const apiKey = process.env.E2B_API_KEY?.trim();

describe("E2B credential", () => {
  it.skipIf(!apiKey)("authenticates with a lightweight sandbox-list request without creating a sandbox", async () => {
    const paginator = Sandbox.list({ apiKey: apiKey! });
    const result = await paginator.nextItems({ apiKey: apiKey! });
    expect(Array.isArray(result)).toBe(true);
  }, 20_000);
});
