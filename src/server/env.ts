import "server-only";
import { checkSupabaseUrl } from "@/lib/supabase-url";

export const supabaseUrlCheck = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (supabaseUrlCheck.problem && process.env.NEXT_PUBLIC_SUPABASE_URL) console.warn(`[flowforge] NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrlCheck.problem}`);

/**
 * Server configuration. Values come from .env (see SETUP.md). Missing optional values switch
 * features off gracefully; missing required values produce a clear NOT_CONFIGURED error.
 */
export const env = {
  supabaseUrl: supabaseUrlCheck.url,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  encryptionKey: process.env.FLOWFORGE_ENCRYPTION_KEY ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  /** Optional: FlowForge's own email sender for notification emails (separate from users' Resend connections). */
  resendApiKey: process.env.RESEND_API_KEY?.trim() ?? "",
  emailFrom: process.env.EMAIL_FROM?.trim() ?? "",
};

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!env.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!env.encryptionKey) missing.push("FLOWFORGE_ENCRYPTION_KEY");
  if (!process.env.INNGEST_EVENT_KEY && process.env.INNGEST_DEV !== "1") missing.push("INNGEST_EVENT_KEY (or INNGEST_DEV=1 locally)");
  return missing;
}
