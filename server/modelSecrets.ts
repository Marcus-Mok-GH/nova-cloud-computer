import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ENV } from "./_core/env";

/** Private custom-model keys are encrypted with AES-256-GCM before they reach Postgres. */
export function createSecretBox(secret: string) {
  if (!secret) throw new Error("Nova cannot protect model credentials because its server secret is unavailable.");
  const key = createHash("sha256").update(secret).digest();
  return {
    encrypt(plainText: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
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

let memoizedSecretBox: ReturnType<typeof createSecretBox> | undefined;
/** Lazily creates and memoizes the secret box derived from the model credential secret. */
function getSecretBox() {
  if (!memoizedSecretBox) memoizedSecretBox = createSecretBox(ENV.modelCredentialSecret);
  return memoizedSecretBox;
}

export const encryptModelApiKey = (apiKey: string) => getSecretBox().encrypt(apiKey);
export const decryptModelApiKey = (cipherText: string) => getSecretBox().decrypt(cipherText);
export const encryptPrivateCredential = encryptModelApiKey;
export const decryptPrivateCredential = decryptModelApiKey;
