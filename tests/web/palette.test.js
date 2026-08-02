import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { THEMES, getTheme } from "../../docs/js/constants/themes.js";

const DOCS = new URL("../../docs/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(css|js)$/.test(entry)) out.push(full);
  }
  return out;
}

/** #RRGGBB -> {r,g,b} */
function parseHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

const isGreenDominant = ({ r, g, b }) => g > r + 6 && g > b + 6;

test("varsayilan tema bordo paletini kullanir", () => {
  const theme = getTheme(0);
  assert.equal(THEMES.length, 1, "tek gorsel dil olmali");
  assert.equal(theme.key, "burgundy");
  assert.equal(theme.backgroundDeep, "#020101");
  assert.equal(theme.backgroundSurface, "#3D0B0D");
  assert.equal(theme.surfaceRaised, "#53080E");
  assert.equal(theme.petalDark, "#72090F");
  assert.equal(theme.petalBright, "#B21F29");
});

test("temada hicbir renk yesil baskin degil", () => {
  const theme = getTheme(0);
  const offenders = [];
  for (const [key, value] of Object.entries(theme)) {
    const rgb = parseHex(value);
    if (rgb && isGreenDominant(rgb)) offenders.push(`${key}=${value}`);
  }
  assert.deepEqual(offenders, [], `yesil baskin tema rengi: ${offenders}`);
});

test("eski yesil paletin hicbir tonu kaynakta kalmadi", () => {
  // Onceki "Biophilic" surumunun renkleri. Biri geri sizarsa test kirilir.
  const legacy = [
    "#06100F", "#0A1916", "#11302B", "#A8C983",
    "#B8E68B", "#DDF1E9", "#F3F1E8", "#A9B7B0", "#71817B", "#0F2A25",
  ];
  const files = walk(DOCS);
  const hits = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const color of legacy) {
      // Yorum satirlarinda gecen tarihsel referanslar sayilmaz.
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        if (!new RegExp(color, "i").test(line)) return;
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        hits.push(`${file.replace(DOCS, "")}:${index + 1} ${color}`);
      });
    }
  }
  assert.deepEqual(hits, [], `eski yesil ton bulundu:\n${hits.join("\n")}`);
});

test("kaynak dosyalarda yesil baskin rgb() kalmadi", () => {
  const files = walk(DOCS);
  const hits = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    source.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      for (const match of line.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
        const rgb = { r: +match[1], g: +match[2], b: +match[3] };
        if (isGreenDominant(rgb)) hits.push(`${file.replace(DOCS, "")}:${index + 1} ${match[0]})`);
      }
    });
  }
  assert.deepEqual(hits, [], `yesil baskin rgb bulundu:\n${hits.join("\n")}`);
});

test("metin renkleri koyu bordo zeminde yeterli kontrast tasir", () => {
  // WCAG rolatif parlaklik.
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };

  const theme = getTheme(0);
  const deep = parseHex(theme.backgroundDeep);
  const surface = parseHex(theme.backgroundSurface);

  // Ana metin her iki zeminde de govde metni esigini (4.5) asmali.
  assert.ok(ratio(parseHex(theme.textPrimary), deep) >= 4.5);
  assert.ok(ratio(parseHex(theme.textPrimary), surface) >= 4.5);
  // Ikincil metin en az buyuk metin esigini (3.0) asmali.
  assert.ok(ratio(parseHex(theme.textSecondary), surface) >= 3);
  // HUD cizgi rengi kamera uzerinde secilebilmeli.
  assert.ok(ratio(parseHex(theme.handLine), deep) >= 4.5, "el iskeleti cizgisi yeterince ayirt edilemiyor");
});
