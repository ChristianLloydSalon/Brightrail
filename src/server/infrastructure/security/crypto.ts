import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api-error";
import { env } from "../config/env";

function key(): Buffer {
  const raw = env.encryptionKey;
  if (!raw) throw new ApiError("NOT_CONFIGURED", "BRIGHTRAIL_ENCRYPTION_KEY is missing from .env (see SETUP.md).");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new ApiError("NOT_CONFIGURED", "BRIGHTRAIL_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return buf;
}
 
/**
 * AES-256-GCM. Output: v2.<iv>.<tag>.<ciphertext> (base64url), with `context` (e.g. "connection:<id>")
 * bound as additional authenticated data, so a ciphertext copied onto another row won't decrypt.
 * Without a context the legacy v1 format (no AAD) is produced.
 */
export function encryptSecret(plain: string, context?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  if (context) c.setAAD(Buffer.from(context, "utf8"));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [context ? "v2" : "v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

/** Decrypts v2 (context-bound) and legacy v1 secrets. A v2 secret requires the same context it was sealed with. */
export function decryptSecret(payload: string, context?: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if ((v !== "v1" && v !== "v2") || !iv || !tag || !data) throw new Error("Unsupported secret format");
  if (v === "v2" && !context) throw new Error("This secret is bound to a record; pass its context to decrypt it");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  if (v === "v2") d.setAAD(Buffer.from(context!, "utf8"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

export const connectionSecretContext = (connectionId: string) => `connection:${connectionId}`;
export const webhookSecretContext = (endpointId: string) => `webhook:${endpointId}`;

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
