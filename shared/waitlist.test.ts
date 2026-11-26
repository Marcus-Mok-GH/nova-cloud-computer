import { describe, expect, it } from "vitest";
import {
  NOVA_WAITLIST_END_MS,
  isWaitlistActive,
  isWaitlistBypassed,
  isWaitlistGatedPath,
  shouldShowWaitlist,
  waitlistReopenLabel,
} from "./waitlist";

describe("waitlist window", () => {
  it("closes the waitlist at the published instant", () => {
    expect(isWaitlistActive(NOVA_WAITLIST_END_MS - 1)).toBe(true);
    expect(isWaitlistActive(NOVA_WAITLIST_END_MS)).toBe(false);
    expect(isWaitlistActive(NOVA_WAITLIST_END_MS + 86_400_000)).toBe(false);
  });

  it("labels the date the waitlist copy prints", () => {
    expect(waitlistReopenLabel()).toBe("1 December");
  });
});

describe("waitlist bypass", () => {
  it("serves the real product for the owner's override", () => {
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

describe("waitlist gated paths", () => {
  it("gates the routes that need the database", () => {
    for (const path of ["/sign-in", "/app", "/app/files", "/app/chats", "/app/billing", "/checkout"]) {
      expect(isWaitlistGatedPath(path)).toBe(true);
    }
  });

  it("leaves the static routes open", () => {
    // The landing page is the way in, and the API docs need no database.
    for (const path of ["/", "/docs", "/docs/api", "/404", "/whatever"]) {
      expect(isWaitlistGatedPath(path)).toBe(false);
    }
    expect(isWaitlistGatedPath("")).toBe(false);
    expect(isWaitlistGatedPath(undefined)).toBe(false);
  });

  it("does not gate a path that merely starts with the same letters", () => {
    expect(isWaitlistGatedPath("/application")).toBe(false);
    expect(isWaitlistGatedPath("/sign-in-other")).toBe(false);
  });
});

describe("shouldShowWaitlist", () => {
  it("shows the waitlist on a gated path while the window is open", () => {
    expect(shouldShowWaitlist("/app", "", NOVA_WAITLIST_END_MS - 60_000)).toBe(true);
    expect(shouldShowWaitlist("/sign-in", "", NOVA_WAITLIST_END_MS - 60_000)).toBe(true);
  });

  it("leaves the static routes alone while the window is open", () => {
    expect(shouldShowWaitlist("/", "", NOVA_WAITLIST_END_MS - 60_000)).toBe(false);
    expect(shouldShowWaitlist("/docs", "", NOVA_WAITLIST_END_MS - 60_000)).toBe(false);
  });

  it("restores the real product once the window closes", () => {
    expect(shouldShowWaitlist("/app", "", NOVA_WAITLIST_END_MS)).toBe(false);
    expect(shouldShowWaitlist("/sign-in", "", NOVA_WAITLIST_END_MS)).toBe(false);
  });

  it("honours the owner's override on a gated path", () => {
    expect(shouldShowWaitlist("/app", "?waitlist=0", NOVA_WAITLIST_END_MS - 60_000)).toBe(false);
    expect(shouldShowWaitlist("/app", "?waitlist=off", NOVA_WAITLIST_END_MS - 60_000)).toBe(false);
  });
});
