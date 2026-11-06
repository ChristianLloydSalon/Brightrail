import type { JsonValue } from "./types";

/** Keys whose values are secrets and must never be shown or stored in run payloads. */
const SECRET_KEYS = /^(authorization|api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password|signing[_-]?secret|card(number)?|cvv|cvc|pan|client[_-]?secret)$/i;
/** Personal data that is partially masked (spec §11 "minimize stored payload data"). */
const PII_KEYS = /(email|phone|address|fullname|customername)$/i;

export const REDACTED = "[REDACTED]";

export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "•••";
  return `${local[0]}•••@${domain}`;
}

function maskPii(value: string): string {
  if (value.includes("@")) return maskEmail(value);
  if (value.length <= 4) return "•••";
  return `${value.slice(0, 2)}•••${value.slice(-2)}`;
}

/** Deeply redacts a payload. Pure: returns a new value. */
export function redact(value: JsonValue, extraSensitive: string[] = []): JsonValue {
  const extra = new Set(extraSensitive.map((k) => k.toLowerCase()));
  const walk = (v: JsonValue, key?: string): JsonValue => {
    if (key && (SECRET_KEYS.test(key) || extra.has(key.toLowerCase()))) return REDACTED;
    if (Array.isArray(v)) return v.map((item) => walk(item));
    if (v && typeof v === "object") {
      const out: Record<string, JsonValue> = {};
      for (const [k, child] of Object.entries(v)) out[k] = walk(child, k);
      return out;
    }
    if (key && typeof v === "string" && PII_KEYS.test(key)) return maskPii(v);
    if (typeof v === "string" && /^(sk|pk|ff|whsec|rk)_(live|test)_[A-Za-z0-9]{6,}/.test(v)) return REDACTED;
    if (typeof v === "string" && /^Bearer\s+/i.test(v)) return REDACTED;
    return v;
  };
  return walk(value);
}

/** Produces a non-reversible hint such as “••••4f2a” for a secret the user just entered. */
export function secretHint(secret: string): string {
  const tail = secret.trim().slice(-4);
  return `••••${tail || "••••"}`;
}
