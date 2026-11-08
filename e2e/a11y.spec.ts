import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { LIVE, signIn, skipUnlessLive } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

test("public screens have no axe violations", async ({ page }) => {
  for (const r of LIVE ? ["/sign-in", "/sign-up", "/forgot-password"] : ["/setup"]) {
    await page.goto(r);
    await page.waitForSelector("h1");
    const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${r}: ${v.id}`)).toEqual([]);
  }
});

test("app screens: axe + no horizontal overflow", async ({ page }) => {
  skipUnlessLive();
  test.setTimeout(240_000);
  await signIn(page);
  const problems: string[] = [];
  for (const r of ["/dashboard", "/workflows", "/executions", "/approvals", "/integrations", "/integrations/webhooks", "/settings/workspace", "/settings/members", "/settings/roles", "/settings/api-keys", "/settings/audit-log", "/settings/profile"]) {
    await page.goto(r);
    await page.waitForSelector("h1", { timeout: 20_000 });
    await page.waitForTimeout(800);
    const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    for (const v of res.violations) problems.push(`${r}: ${v.id}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`${r}: horizontal overflow ${overflow}px`);
  }
  expect(problems).toEqual([]);
});
