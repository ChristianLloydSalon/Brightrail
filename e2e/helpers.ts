import { expect, test, type Page } from "@playwright/test";

/** Live tests need a confirmed test user in your Supabase project (see SETUP.md → Testing). */
export const LIVE = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
export const skipUnlessLive = () => test.skip(!LIVE, "Set E2E_EMAIL and E2E_PASSWORD to run live tests against your Supabase project.");

export async function signIn(page: Page, path = "/dashboard") {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").first().fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/dashboard|onboarding/);
  if (path !== "/dashboard") await page.goto(path);
}
