import { expect, test } from "@playwright/test";
import { signIn, skipUnlessLive } from "./helpers";

test.beforeEach(() => skipUnlessLive());

test("sign-in validation and wrong password", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").first().fill("definitely-wrong-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
});

test("create a workflow, add a step with the keyboard, save, publish, run", async ({ page }) => {
  await signIn(page, "/workflows");
  await page.getByRole("button", { name: "Create workflow" }).first().click();
  await page.getByLabel("Name").fill(`E2E manual ${Date.now()}`);
  await page.getByText("Manual", { exact: true }).click();
  await page.getByRole("button", { name: "Create and open editor" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByRole("tab", { name: "Outline" }).click();
  await page.getByRole("list", { name: "Workflow outline" }).getByRole("button").first().click();
  await page.getByRole("tab", { name: "Add steps" }).click();
  await page.getByRole("button", { name: /Add Delay step/ }).click();
  await page.getByRole("spinbutton", { name: "Wait for" }).fill("2");
  await page.getByRole("combobox", { name: "Unit" }).click();
  await page.getByRole("option", { name: "Seconds" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  const dlg = page.getByRole("dialog", { name: /Publish version 1/ });
  await dlg.getByLabel("Change note").fill("E2E first version");
  await dlg.getByRole("button", { name: /Publish version 1/ }).click();
  await expect(page.getByText("Version 1 published", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to workflow details" }).click();
  await page.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/executions\//);
  // Requires the Inngest dev server (or Inngest Cloud) to be running.
  await expect(page.getByText("Run status: Succeeded")).toBeAttached({ timeout: 60_000 });
});
