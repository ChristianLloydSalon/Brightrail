export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(v: string): string | null {
  if (!v.trim()) return "Enter your email address.";
  if (!EMAIL_RE.test(v.trim())) return "Enter an email address like name@company.com.";
  return null;
}

export const PASSWORD_RULES = [
  { id: "length", label: "At least 10 characters", test: (v: string) => v.length >= 10 },
  { id: "letter", label: "Contains a letter", test: (v: string) => /[A-Za-z]/.test(v) },
  { id: "number", label: "Contains a number", test: (v: string) => /\d/.test(v) },
] as const;

export function validateNewPassword(v: string): string | null {
  if (!v) return "Create a password.";
  const failed = PASSWORD_RULES.filter((r) => !r.test(v));
  if (failed.length) return `Password needs: ${failed.map((r) => r.label.toLowerCase()).join(", ")}.`;
  return null;
}

export function passwordStrength(v: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (v.length >= 10) score++;
  if (v.length >= 14) score++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
  if (/[^A-Za-z0-9]/.test(v) && /\d/.test(v)) score++;
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: ["Too weak", "Weak", "Fair", "Good", "Strong"][s]! };
}

export type Errors<K extends string> = Partial<Record<K, string | null>>;
export const hasErrors = (e: Record<string, string | null | undefined>) => Object.values(e).some(Boolean);
