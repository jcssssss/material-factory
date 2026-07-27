import { test, expect } from "@playwright/test";

test.describe("App 基本加载", () => {
  test("首页应该正常渲染", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/小红书素材工厂/);
  });

  test("侧边栏导航应该存在", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    const navLinks = sidebar.locator("a");
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
