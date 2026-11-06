/**
 * Pure execution helpers shared by the worker and tests. No I/O here.
 */
import type { ConditionConfig, ErrorClass, TransformConfig } from "@/lib/domain/types";
import { getPath, setPath } from "@/lib/utils";

export const ERROR_CLASS_LABELS: Record<ErrorClass, string> = {
  transient: "Transient",
  configuration: "Configuration",
  validation: "Validation",
  permission: "Permission",
  unknown: "Unknown",
};

/** Replaces {{path}} placeholders with values from the run data. Missing values become empty strings. */
export function fillTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, p: string) => {
    const v = getPath(data, p);
    if (v === undefined || v === null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

/**
 * Input mapping value: text containing {{…}} is a template; anything else is treated as a field
 * path, falling back to the literal text when the path doesn't exist and it contains spaces.
 */
export function resolveValue(source: string, data: Record<string, unknown>): unknown {
  if (source.includes("{{")) return fillTemplate(source, data);
  const v = getPath(data, source);
  if (v === undefined && /\s/.test(source)) return source;
  return v;
}

export function evalCondition(c: ConditionConfig, data: Record<string, unknown>): boolean {
  const actual = getPath(data, c.field);
  const expected = c.value;
  switch (c.operator) {
    case "exists": return actual !== undefined && actual !== null && actual !== "";
    case "equals": return String(actual) === expected;
    case "not_equals": return String(actual) !== expected;
    case "greater_than": return Number(actual) > Number(expected);
    case "less_than": return Number(actual) < Number(expected);
    case "contains": return Array.isArray(actual) ? actual.map(String).includes(expected) : String(actual ?? "").includes(expected);
  }
}

/** Applies safe mapping functions. Returns the mapped object and writes the targets into `data`. */
export function applyTransform(c: TransformConfig, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of c.mappings) {
    if (!m.target) continue;
    let v = getPath(data, m.source);
    switch (m.fn) {
      case "uppercase": v = typeof v === "string" ? v.toUpperCase() : v; break;
      case "lowercase": v = typeof v === "string" ? v.toLowerCase() : v; break;
      case "to_number": v = v === undefined ? undefined : Number(v); break;
      case "to_string": v = v === undefined ? undefined : String(v); break;
      case "trim": v = typeof v === "string" ? v.trim() : v; break;
      case "default": v = v === undefined || v === null || v === "" ? m.fallback : v; break;
      case "copy": break;
    }
    setPath(out, m.target, v);
    setPath(data, m.target, v);
  }
  return out;
}

function fnv(input: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable per run + node + logical attempt scope (spec §07), so retries reuse it. */
export function idempotencyKey(runId: string, nodeId: string) {
  return `ff_${fnv(`${runId}:${nodeId}`)}${fnv(`${nodeId}:${runId}:logical-1`)}`;
}

export function backoffSeconds(attempt: number, initial = 2, coefficient = 2, max = 60) {
  return Math.min(max, Math.round(initial * coefficient ** (attempt - 1)));
}

export interface StepFailure {
  code: string;
  message: string;
  errorClass: ErrorClass;
  retryable: boolean;
}

export function classifyHttpStatus(status: number, provider: string): StepFailure {
  if (status === 429) return { code: "HTTP_429_RATE_LIMITED", message: `${provider} rate-limited the request (429).`, errorClass: "transient", retryable: true };
  if (status >= 500) return { code: `HTTP_${status}`, message: `${provider} returned ${status}.`, errorClass: "transient", retryable: true };
  if (status === 401 || status === 403) return { code: `HTTP_${status}_UNAUTHORIZED`, message: `${provider} rejected the credential (${status}). It may be expired, revoked or missing a scope.`, errorClass: "permission", retryable: false };
  if (status === 400 || status === 422) return { code: `HTTP_${status}_INVALID_REQUEST`, message: `${provider} rejected the request as invalid (${status}). Check the step's inputs.`, errorClass: "validation", retryable: false };
  if (status === 404) return { code: "HTTP_404_NOT_FOUND", message: `${provider} returned 404 Not Found. Check the URL.`, errorClass: "configuration", retryable: false };
  return { code: `HTTP_${status}`, message: `${provider} returned ${status}.`, errorClass: "unknown", retryable: false };
}
