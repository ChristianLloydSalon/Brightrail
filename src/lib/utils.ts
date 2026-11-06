import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export function uid(prefix: string, length = 10): string {
  let out = "";
  const bytes = typeof crypto !== "undefined" && "getRandomValues" in crypto ? crypto.getRandomValues(new Uint8Array(length)) : null;
  for (let i = 0; i < length; i++) out += ALPHABET[(bytes ? bytes[i]! : Math.floor(Math.random() * 256)) % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Deterministic PRNG for seed data (mulberry32). */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

/** Keys that would reach an object's prototype. Never read or written through a user-supplied path. */
export const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object" || UNSAFE_KEYS.has(p) || !Object.hasOwn(cur, p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  if (parts.some((p) => UNSAFE_KEYS.has(p))) throw new Error(`“${path}” isn't an allowed field name.`);
  let cur: Record<string, unknown> = obj;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value;
    else {
      if (!Object.hasOwn(cur, p) || typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
  });
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
