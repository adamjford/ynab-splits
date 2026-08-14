import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function keyBytes(secret: string): Buffer {
  const key = Buffer.from(secret, "utf8");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  return key;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decryptSecret(serialized: string, secret: string): string {
  const parts = serialized.split(".");
  if (parts.length !== 3) throw new Error("invalid encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(secret), Buffer.from(parts[0], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[1], "base64url")), decipher.final()]).toString("utf8");
}

export function signValue(value: unknown, secret: string): string {
  const payload = encode(JSON.stringify(value));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyValue<T>(serialized: string, secret: string): T {
  const parts = serialized.split(".");
  if (parts.length !== 2) throw new Error("invalid signed value");
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("invalid signature");
  return JSON.parse(decode(parts[0])) as T;
}
