import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ENV } from "./_core/env";

/**
 * API keys for user-defined model endpoints are encrypted before database storage.
 * Ciphertext is intentionally the only key-related value ever persisted or returned by the data layer.
 */
export function createSecretBox(secret: string) {
  if (!secret) throw new Error("Nova cannot protect model credentials because its server secret is unavailable.");
  const key = createHash("sha256").update(secret).digest();

  return {
    encrypt(plainText: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [iv, tag, encrypted].map(part => part.toString("base64url")).join(".");
    },
    decrypt(cipherText: string) {
      const [ivPart, tagPart, payloadPart] = cipherText.split(".");
      if (!ivPart || !tagPart || !payloadPart) throw new Error("Saved model credential is malformed.");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
      decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(payloadPart, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}

export function encryptModelApiKey(apiKey: string) {
  return createSecretBox(ENV.cookieSecret).encrypt(apiKey);
}

export function decryptModelApiKey(cipherText: string) {
  return createSecretBox(ENV.cookieSecret).decrypt(cipherText);
}
