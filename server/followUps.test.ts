import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_MESSAGE_PREFIX,
  MAX_FOLLOW_UPS,
  buildFollowUpMessage,
  normalizeFollowUps,
  parseFollowUpMessage,
} from "./followUps";

describe("normalizeFollowUps", () => {
  it("keeps at most three suggestions, in order", () => {
    expect(
      normalizeFollowUps(["one", "two", "three", "four", "five"])
    ).toEqual(["one", "two", "three"]);
    expect(MAX_FOLLOW_UPS).toBe(3);
  });

  it("trims entries and drops blanks, non-strings and case-insensitive duplicates", () => {
    expect(
      normalizeFollowUps([
        "  Deploy the site ",
        "deploy the SITE",
        "",
        "   ",
        42,
        null,
        "Add a contact form",
      ])
    ).toEqual(["Deploy the site", "Add a contact form"]);
  });

  it("accepts a single string as one suggestion", () => {
    expect(normalizeFollowUps("Ship it")).toEqual(["Ship it"]);
  });

  it("drops unusable shapes entirely", () => {
    expect(normalizeFollowUps(undefined)).toEqual([]);
    expect(normalizeFollowUps(null)).toEqual([]);
    expect(normalizeFollowUps({ follow_ups: ["Ship it"] })).toEqual([]);
    expect(normalizeFollowUps([null, 7, {}])).toEqual([]);
  });

  it("caps one runaway suggestion so it cannot bloat the ledger", () => {
    const [stored] = normalizeFollowUps(["x".repeat(500)]);
    expect(stored).toHaveLength(200);
    expect(stored.endsWith("x")).toBe(true);
  });
});

describe("follow-up ledger row", () => {
  it("round-trips suggestions through the prefixed JSON row", () => {
    const row = buildFollowUpMessage(["Deploy the site", "Add a contact form"]);
    expect(row.startsWith(FOLLOW_UP_MESSAGE_PREFIX)).toBe(true);
    expect(parseFollowUpMessage(row)).toEqual([
      "Deploy the site",
      "Add a contact form",
    ]);
  });

  it("rejects non-follow-up rows and broken payloads", () => {
    expect(parseFollowUpMessage("hello")).toBeNull();
    expect(
      parseFollowUpMessage(`${FOLLOW_UP_MESSAGE_PREFIX}not json`)
    ).toBeNull();
    expect(
      parseFollowUpMessage(`${FOLLOW_UP_MESSAGE_PREFIX}{"a":1}`)
    ).toBeNull();
    expect(parseFollowUpMessage(`${FOLLOW_UP_MESSAGE_PREFIX}[]`)).toBeNull();
    expect(
      parseFollowUpMessage(`${FOLLOW_UP_MESSAGE_PREFIX}["   "]`)
    ).toBeNull();
  });

  it("normalizes whatever a row parses back to", () => {
    const row = `${FOLLOW_UP_MESSAGE_PREFIX}${JSON.stringify([
      " A ",
      "a",
      "B",
      "C",
      "D",
    ])}`;
    expect(parseFollowUpMessage(row)).toEqual(["A", "B", "C"]);
    // The built row itself is capped, so a caller cannot bypass the limit.
    expect(
      JSON.parse(
        buildFollowUpMessage(["a", "b", "c", "d"]).slice(
          FOLLOW_UP_MESSAGE_PREFIX.length
        )
      )
    ).toEqual(["a", "b", "c"]);
  });
});
