import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api-error";
import { env } from "./env";

function key(): Buffer {
  const raw = env.encryptionKey;
  if (!raw) throw new ApiError("NOT_CONFIGURED", "FLOWFORGE_ENCRYPTION_KEY is missing from .env (see SETUP.md).");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new ApiError("NOT_CONFIGURED", "FLOWFORGE_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return buf;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unsupported secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

export function randomToken(prefix: string, bytes = 24) {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
