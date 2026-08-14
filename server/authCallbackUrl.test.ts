import { describe, expect, it } from "vitest";
import { getMagicLinkCallbackUrl } from "../client/src/lib/authCallbackUrl";

describe("getMagicLinkCallbackUrl", () => {
  it("uses Nova's stable production URL for a dynamic Vercel deployment alias", () => {
    expect(
      getMagicLinkCallbackUrl("https://nova-cloud-computer-1d9adaops-sjdjdiejdrirhdkjejs-projects.vercel.app"),
    ).toBe("https://nova-cloud-computer.vercel.app/app");
  });

  it("uses an explicit public application origin when one is configured", () => {
    expect(
      getMagicLinkCallbackUrl("https://preview.example.test", "https://nova.example.com/"),
    ).toBe("https://nova.example.com/app");
  });

  it("keeps a custom live origin when no explicit origin is configured", () => {
    expect(getMagicLinkCallbackUrl("https://nova.example.com")).toBe("https://nova.example.com/app");
  });
});
