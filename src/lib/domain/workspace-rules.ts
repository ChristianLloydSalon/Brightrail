import { slugify } from "@/lib/utils";
import type { WorkspaceSettings } from "./types";

export type FieldErrors = Record<string, string>;

/** Validates workspace settings and returns only the known keys, never extra ones sent by a client. */
export function validateWorkspaceSettings(input: { name: string; slug: string; settings: WorkspaceSettings }): { errors: FieldErrors; slug: string; settings: WorkspaceSettings } {
  const errors: FieldErrors = {};
  if (input.name.trim().length < 2) errors.name = "Use at least 2 characters.";
  const slug = slugify(input.slug);
  if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)) errors.slug = "Use 3–48 lowercase letters, numbers and hyphens.";
  const s = input.settings;
  const r = s.defaultRetry;
  if (r.maxAttempts < 1 || r.maxAttempts > 10) errors.maxAttempts = "Use between 1 and 10.";
  if (r.initialIntervalSec < 1 || r.initialIntervalSec > 300) errors.initialIntervalSec = "Use between 1 and 300 seconds.";
  if (r.maxIntervalSec < r.initialIntervalSec) errors.maxIntervalSec = "Must be at least the initial interval.";
  if (![7, 14, 30, 90].includes(s.retentionDays)) errors.retentionDays = "Choose 7, 14, 30 or 90 days.";
  if (!Number.isFinite(r.backoffCoefficient) || r.backoffCoefficient < 1 || r.backoffCoefficient > 10) errors.backoffCoefficient = "Use between 1 and 10.";
  if (!Number.isInteger(s.approvalExpiryHours) || s.approvalExpiryHours < 1 || s.approvalExpiryHours > 168) errors.approvalExpiryHours = "Use between 1 and 168 hours.";
  if (s.payloadStorage !== "redacted" && s.payloadStorage !== "minimal") errors.payloadStorage = "Choose a payload storage option.";
  if (typeof s.aiAssistantEnabled !== "boolean") errors.aiAssistantEnabled = "Choose on or off.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s.timezone });
  } catch {
    errors.timezone = "Choose a valid time zone.";
  }
  const settings: WorkspaceSettings = {
    timezone: s.timezone, retentionDays: s.retentionDays, payloadStorage: s.payloadStorage, aiAssistantEnabled: s.aiAssistantEnabled, approvalExpiryHours: s.approvalExpiryHours,
    defaultRetry: { maxAttempts: r.maxAttempts, initialIntervalSec: r.initialIntervalSec, backoffCoefficient: r.backoffCoefficient, maxIntervalSec: r.maxIntervalSec },
  };
  return { errors, slug, settings };
}

/** Names of settings whose value differs (for the audit entry). */
export function changedSettings(next: WorkspaceSettings, prev: WorkspaceSettings): string[] {
  return (Object.keys(next) as Array<keyof WorkspaceSettings>).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
}

/** A slug for a new workspace name; the database allows 3–48 characters. */
export function baseSlugFor(name: string): string {
  let slug = slugify(name.trim()).replace(/^-+|-+$/g, "");
  if (slug.length < 3) slug = `${slug || "team"}-workspace`;
  return slug.slice(0, 40).replace(/-+$/, "");
}
