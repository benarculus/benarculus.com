import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const articlePath =
  "/blog/generate-clarity-by-establishing-a-writing-practice/";

for (const path of ["/", "/blog/", articlePath]) {
  test(`${path} is accessible and script-light`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    await expect(
      page.locator('script:not([type="application/ld+json"])'),
    ).toHaveCount(0);
  });
}

test("primary navigation reaches the notes index and article", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Notes", exact: true }).click();
  await expect(page).toHaveURL(/\/blog\/$/);
  await page
    .getByRole("link", {
      name: "Generate Clarity by Establishing a Writing Practice.",
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
});

test("keyboard focus is visible", async ({ browserName, page }) => {
  await page.goto("/");
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
});

for (const path of ["/", "/blog/", articlePath]) {
  test(`${path} reflows at 320 CSS pixels`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(path);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
}
