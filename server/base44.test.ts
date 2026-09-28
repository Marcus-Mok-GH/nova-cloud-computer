import { describe, expect, it } from "vitest";
import {
  BASE44_ALPHABET,
  decodeBase44,
  decodeBase44Text,
  encodeBase44,
  encodeBase44Text,
} from "./base44";

describe("Base44", () => {
  it("uses the documented QR-compatible alphabet", () => {
    expect(BASE44_ALPHABET).toBe("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$%*+-./:");
    expect(BASE44_ALPHABET).toHaveLength(44);
  });

  it("matches the byte-pair encoding vectors", () => {
    expect(encodeBase44(new Uint8Array())).toBe("");
    expect(encodeBase44(new Uint8Array([0x41]))).toBe("L1");
    expect(encodeBase44(new Uint8Array([0x41, 0x42]))).toBe("UR8");
    expect(encodeBase44(new Uint8Array([0x00, 0x01, 0xff]))).toBe("100Z5");
  });

  it("round-trips arbitrary bytes and UTF-8 text", () => {
    const bytes = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
    expect(Array.from(decodeBase44(encodeBase44(bytes)))).toEqual(Array.from(bytes));

    const text = "Nova ☁️ — café";
    expect(decodeBase44Text(encodeBase44Text(text))).toBe(text);
  });

  it("rejects malformed or non-canonical groups", () => {
    expect(() => decodeBase44("0")).toThrow("cannot end with one character");
    expect(() => decodeBase44("::")).toThrow("more than one byte");
    expect(() => decodeBase44(":::")) .toThrow("more than two bytes");
    expect(() => decodeBase44("!0")).toThrow("Invalid Base44 character");
    expect(() => decodeBase44Text(encodeBase44(new Uint8Array([0xff])))).toThrow();
  });
});
