import { expect, test } from "vitest";
import { checkSupabaseUrl as c } from "@/lib/supabase-url";
test("normalises", () => {
  expect(c("https://abcdefghijklmnop.supabase.co")).toEqual({ url: "https://abcdefghijklmnop.supabase.co", fatal: false, problem: undefined });
  expect(c("https://abcdefghijklmnop.supabase.co/rest/v1/").url).toBe("https://abcdefghijklmnop.supabase.co");
  expect(c("https://abcdefghijklmnop.supabase.co/auth/v1").problem).toMatch(/removed/);
  expect(c(' "https://abcdefghijklmnop.supabase.co/" ').problem).toBeUndefined();
  expect(c("abcdefghijklmnop.supabase.co").url).toBe("https://abcdefghijklmnop.supabase.co");
  expect(c("https://supabase.com/dashboard/project/abcdefghijklmnop/settings/api").url).toBe("https://abcdefghijklmnop.supabase.co");
  expect(c("postgresql://postgres:x@db.abc.supabase.co:5432/postgres").fatal).toBe(true);
  expect(c("").fatal).toBe(true);
  expect(c("http://127.0.0.1:54321").url).toBe("http://127.0.0.1:54321");
});
