// harmoni.py run_self_test() ruhunda tarayici-ici duman testi bataryasi.
// ?debug=1 ile yuklenir. Her milestone kendi kontrollerini buraya ekler;
// Milestone 1 itibariyle yalnizca makam tablosu butunlugu test edilebilir.
import { MAKAM_SCALES_KOMA, makamScaleDegreesKomas } from "../constants/makam.js";

function log(el, line, ok) {
  const prefix = ok === undefined ? "  " : ok ? "[PASS] " : "[FAIL] ";
  const text = `${prefix}${line}`;
  el.textContent += text + "\n";
  (ok === false ? console.error : console.log)(text);
}

function testMakamIntegrity(el) {
  let allOk = true;
  for (const [name, intervals] of Object.entries(MAKAM_SCALES_KOMA)) {
    const sum = intervals.reduce((a, b) => a + b, 0);
    const okSum = sum === 53;
    const degrees = makamScaleDegreesKomas(name);
    const okDegrees = degrees.length === 7 && degrees[0] === 0 && new Set(degrees).size === 7;
    if (!okSum || !okDegrees) allOk = false;
    log(el, `${name}: koma toplami=${sum}, dereceler=[${degrees.join(",")}]`, okSum && okDegrees);
  }
  return allOk;
}

export function runSelfTest(el) {
  el.textContent = "Harmoni web self-test\n======================\n";
  const results = [testMakamIntegrity(el)];
  const passed = results.filter(Boolean).length;
  log(el, `\nToplam: ${passed}/${results.length} test grubu basarili.`);
}
