/**
 * Normalises NEXT_PUBLIC_SUPABASE_URL to the bare project origin (https://<ref>.supabase.co).
 *
 * Supabase answers "Invalid path specified in request URL" when the configured URL carries a path
 * (for example the REST endpoint `https://<ref>.supabase.co/rest/v1/`), because the client then
 * calls `/rest/v1/auth/v1/signup`. We keep only the origin and explain what was wrong.
 */
export interface SupabaseUrlCheck {
  /** Usable origin, or "" when the value can't be used. */
  url: string;
  /** Plain-language note when the value was missing, invalid or had to be corrected. */
  problem?: string;
  fatal: boolean;
}

export function checkSupabaseUrl(raw: string | undefined): SupabaseUrlCheck {
  const value = (raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!value) return { url: "", fatal: true, problem: "Missing." };

  // Pasted the dashboard address instead of the project URL.
  const dash = value.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,})/i);
  if (dash) return { url: `https://${dash[1]!.toLowerCase()}.supabase.co`, fatal: false, problem: "This is the dashboard address; using the project URL instead. Copy the Project URL from Project Settings → API." };

  const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (scheme && scheme !== "https" && scheme !== "http")
    return { url: "", fatal: true, problem: `That's a ${scheme}:// address (probably the database connection string). Use the Project URL from Project Settings → API, e.g. https://abcdefghijklmnop.supabase.co` };
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { url: "", fatal: true, problem: "Not a valid URL. It should look like https://abcdefghijklmnop.supabase.co" };
  }

  const notes: string[] = [];
  if (!/^https?:\/\//i.test(value)) notes.push("added https://");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) notes.push(`removed “${parsed.pathname}${parsed.search}${parsed.hash}” from the end`);
  return { url: parsed.origin, fatal: false, problem: notes.length ? `Corrected automatically (${notes.join(", ")}). Use just https://<project-ref>.supabase.co in .env.` : undefined };
}

/** Normalised project URL, or "" when unusable. Safe in the browser and on the server. */
export const supabaseUrl = () => checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL).url;
