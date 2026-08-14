import { describe, expect, it } from "vitest";
import { createSecretBox } from "./modelSecrets";

describe("custom model credential encryption", () => {
  it("round-trips an API key without exposing plaintext in the stored payload", () => {
    const box = createSecretBox("unit-test-secret");
    const apiKey = "sk-private-value";
    const cipherText = box.encrypt(apiKey);
    expect(cipherText).not.toContain(apiKey);
    expect(box.decrypt(cipherText)).toBe(apiKey);
  });

  it("rejects ciphertext modified after encryption", () => {
    const box = createSecretBox("unit-test-secret");
    const cipherText = box.encrypt("sk-private-value");
    const [iv, tag, payload] = cipherText.split(".");
    expect(() => box.decrypt(`${iv}.${tag}.${payload}x`)).toThrow();
  });
});
