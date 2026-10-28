import { describe, expect, it } from "vitest";
import {
  NOVA_WAITLIST_END_MS,
  isWaitlistActive,
  isWaitlistBypassed,
  waitlistLaunchLabel,
} from "./waitlist";

describe("waitlist window", () => {
  it("closes the waitlist at the published launch instant", () => {
    expect(isWaitlistActive(NOVA_WAITLIST_END_MS - 1)).toBe(true);
    expect(isWaitlistActive(NOVA_WAITLIST_END_MS)).toBe(false);
    expect(isWaitlistActive(NOVA_WAITLIST_END_MS + 86_400_000)).toBe(false);
  });

  it("labels the launch date the waitlist copy prints", () => {
    expect(waitlistLaunchLabel()).toBe("1 November");
  });
});

describe("waitlist bypass", () => {
  it("serves the real sign-in for the owner's override", () => {
    expect(isWaitlistBypassed("?waitlist=0")).toBe(true);
    expect(isWaitlistBypassed("?waitlist=off")).toBe(true);
    expect(isWaitlistBypassed("?waitlist=FALSE")).toBe(true);
    expect(isWaitlistBypassed("?foo=1&waitlist=0")).toBe(true);
  });

  it("ignores anything that is not an explicit off switch", () => {
    expect(isWaitlistBypassed("")).toBe(false);
    expect(isWaitlistBypassed(undefined)).toBe(false);
    expect(isWaitlistBypassed(null)).toBe(false);
    expect(isWaitlistBypassed("?waitlist=1")).toBe(false);
    expect(isWaitlistBypassed("?waitlist=")).toBe(false);
    expect(isWaitlistBypassed("?other=0")).toBe(false);
  });
});