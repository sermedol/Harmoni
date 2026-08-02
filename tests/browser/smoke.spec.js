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

// canvas-hud.js sabit mantiksal koordinatlara ciziyor. DOM kromu (menu
// butonu, KAMERA AKTIF rozeti, kayit rozeti, imza) bu bloklarin uzerine
// binmemeli. Daha once KAMERA AKTIF rozeti TEMPO/BPM blogunun, menu butonu
// da HARMONI kimlik blogunun tam ustunde duruyordu.
test("DOM chrome does not overlap the canvas HUD blocks", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  await page.locator("#start-button").click();
  // Krom ogeleri .5sn'lik bir giris animasyonuyla yerine oturuyor; olcum
  // yerlesmis durumda yapilmali.
  await page.waitForTimeout(800);

  const overlaps = await page.evaluate(() => {
    const canvas = document.querySelector("#scene-canvas");
    const stage = document.querySelector(".stage");
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const logicalW = canvas.width;
    const logicalH = canvas.height;
    const scale = canvasRect.width / logicalW;
    const portrait = logicalH > logicalW;
    const deckReserve = portrait ? 154 + 16 : 112 + 22;
    const box = (x1, y1, x2, y2) => [x1 * scale, y1 * scale, x2 * scale, y2 * scale];
    const zones = {
      identity: box(22, 22, 182, 100),
      chord: box(logicalW / 2 - 215, 22, logicalW / 2 + 215, 95),
      tempo: box(logicalW - 140, 20, logicalW, 111),
      deck: box(22, logicalH - deckReserve, logicalW - 22, logicalH),
    };
    const intersects = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
    const found = [];
    const boxes = {};
    for (const selector of [".camera-active", ".hand-status", "#panel-toggle", ".rec-badge", ".feza-signature"]) {
      const element = document.querySelector(selector);
      if (!element) continue;
      element.hidden = false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const local = [rect.left - stageRect.left, rect.top - stageRect.top, rect.right - stageRect.left, rect.bottom - stageRect.top];
      boxes[selector] = local;
      for (const [name, zone] of Object.entries(zones)) {
        if (intersects(local, zone)) found.push(`${selector} ~ ${name}`);
      }
    }
    // Sag kenardaki durum rayinda ogeler ust uste dizili; birbirlerine de
    // binmemeliler.
    const names = Object.keys(boxes);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        if (intersects(boxes[names[i]], boxes[names[j]])) found.push(`${names[i]} ~ ${names[j]}`);
      }
    }
    return found;
  });

  expect(overlaps).toEqual([]);
});

test("vocal studio opens with a complete control surface", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/?demo=1");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  await page.locator("#start-button").click();

  await page.locator("#panel-toggle").click();
  await page.locator("#opt-vocal-studio").click();
  await expect(page.locator("#vocal-studio-overlay")).toBeVisible();

  // Talep edilen tum kontroller bulunmali.
  for (const id of [
    "#vocal-mic", "#vocal-record", "#vocal-play", "#vocal-download", "#vocal-discard",
    "#vocal-gain", "#vocal-reverb", "#vocal-echo", "#vocal-fx-toggle", "#vocal-monitor-toggle",
    "#vocal-timer", "#vocal-status",
  ]) {
    await expect(page.locator(id)).toBeVisible();
  }

  // Mikrofon yokken kayit ve kayit sonrasi eylemler kapali olmali.
  await expect(page.locator("#vocal-record")).toBeDisabled();
  await expect(page.locator("#vocal-play")).toBeDisabled();
  await expect(page.locator("#vocal-download")).toBeDisabled();

  // Canli dinleme uyarisi gorunur olmali (hoparlorle geri besleme riski).
  await expect(page.locator("#vocal-monitor-hint")).toContainText("kulaklık");

  // Escape kapatmali.
  await page.keyboard.press("Escape");
  await expect(page.locator("#vocal-studio-overlay")).toBeHidden();
  expect(errors).toEqual([]);
});

test("vocal effect sliders reach the audio engine", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  await page.locator("#start-button").click();
  await page.locator("#panel-toggle").click();
  await page.locator("#opt-vocal-studio").click();

  const sent = await page.evaluate(() => {
    const graph = window.__harmoni.audioGraph;
    const messages = [];
    graph.postControl = (payload) => messages.push(payload);
    const set = (id, value) => {
      const input = document.getElementById(id);
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("vocal-gain", 180);
    set("vocal-reverb", 22);
    set("vocal-echo", 11);
    document.getElementById("vocal-fx-toggle").click();
    return messages;
  });

  const last = sent.at(-1);
  assertClose(last.vocalInputGain, 1.8);
  assertClose(last.vocalReverbMix, 0.22);
  assertClose(last.vocalEchoMix, 0.11);
  expect(last.vocalEnabled).toBe(false);      // efektler kapatildi

  function assertClose(actual, expected) {
    expect(Math.abs(actual - expected)).toBeLessThan(1e-6);
  }
});

test("open menu stays inside the viewport", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.locator("#start-overlay").click({ position: { x: 8, y: 8 } });
  await page.locator("#start-button").click();
  await page.locator("#panel-toggle").click();
  // Panel .24sn'lik bir transform gecisiyle iceri kayiyor; olcum gecis
  // bitmeden yapilirsa panel hala ekranin solunda gorunur.
  await page.locator("#options-panel").evaluate((panel) => new Promise((resolve) => {
    const settled = () => Math.abs(panel.getBoundingClientRect().left) < 1;
    if (settled()) return resolve();
    const started = performance.now();
    const poll = () => (settled() || performance.now() - started > 2000) ? resolve() : requestAnimationFrame(poll);
    poll();
  }));
  const bounds = await page.locator("#options-panel").evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  });
  // Alt piksel yuvarlamasi icin sag/alt kontrolleriyle ayni tolerans.
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.top).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
});
