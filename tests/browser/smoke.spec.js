import { test, expect } from "@playwright/test";

test("intro can be skipped and CTA is truthful", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  await expect(page.locator("#start-panel")).toHaveClass(/intro-ready/);
  await expect(page.locator("#start-button span")).toHaveText("PERFORMANSI BAŞLAT");
  expect(errors).toEqual([]);
});

test("Tab keeps native focus navigation", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  const tag = await page.evaluate(() => document.activeElement?.tagName);
  expect(["BUTTON", "SELECT", "A"]).toContain(tag);
});

test("390px portrait has no horizontal document overflow", async ({ page }) => {
  await page.goto("/");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
});

test("camera controls and privacy disclosure are available", async ({ page }) => {
  await page.goto("/");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".camera-privacy")).toContainText("Sunucuya yüklenmez");
  await expect(page.locator("#opt-camera-performance")).toHaveValue("auto");
  await expect(page.locator("#camera-restart")).toHaveAttribute("aria-label", "Kamerayı yeniden başlat");
});
