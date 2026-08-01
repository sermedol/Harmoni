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

test("performance scene is filterless and matches viewport without cropping", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  await page.locator("#start-button").click();
  const result = await page.evaluate(() => {
    const canvas = document.querySelector("#scene-canvas");
    const stage = document.querySelector(".stage");
    return {
      ratioDifference: Math.abs(canvas.width / canvas.height - innerWidth / innerHeight),
      filter: getComputedStyle(canvas).filter,
      before: getComputedStyle(stage, "::before").display,
      after: getComputedStyle(stage, "::after").display,
      visibleSignatures: [...document.querySelectorAll(".start-signature,.feza-signature")]
        .filter((element) => getComputedStyle(element).display !== "none").length,
    };
  });
  expect(result.ratioDifference).toBeLessThan(0.003);
  expect(result.filter).toBe("none");
  expect(result.before).toBe("none");
  expect(result.after).toBe("none");
  expect(result.visibleSignatures).toBeLessThanOrEqual(1);
});

test("open menu stays inside the viewport", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  await page.locator("#start-button").click();
  await page.locator("#panel-toggle").click();
  const bounds = await page.locator("#options-panel").evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
});
