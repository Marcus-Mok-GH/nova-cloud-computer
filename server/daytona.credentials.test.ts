import { Daytona } from "@daytona/sdk";
import { describe, expect, it } from "vitest";

const apiKey = process.env.DAYTONA_API_KEY?.trim();

describe("Daytona credential", () => {
  it.skipIf(!apiKey)("authenticates with a lightweight sandbox-list request without creating a VM", async () => {
    const client = new Daytona({
      apiKey: apiKey!,
      apiUrl: process.env.DAYTONA_API_URL?.trim() || "https://app.daytona.io/api",
      target: process.env.DAYTONA_TARGET?.trim() || "us",
      useDeprecatedPolling: true,
    });
    const iterator = client.list();
    const result = await iterator.next();
    expect(result).toHaveProperty("done");
  }, 20_000);
});
