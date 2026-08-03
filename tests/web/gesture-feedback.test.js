import test from "node:test";
import assert from "node:assert/strict";
import { GestureController } from "../../docs/js/camera/gesture-controller.js";

function makeState() {
  return {
    gesture: "",
    gestureDetail: "",
    gestureEvent: null,
    activeLayers: new Set(["PIANO"]),
    brightness: 0.5,
    articulation: 0.5,
    fxAmount: 0,
    density: 0.4,
  };
}

function makeActions(state) {
  return {
    toggleLayer(name) {
      if (state.activeLayers.has(name)) { state.activeLayers.delete(name); return false; }
      state.activeLayers.add(name); return true;
    },
    fullOrchestra() { for (const l of ["PIANO", "STRINGS", "DRUMS", "BASS"]) state.activeLayers.add(l); },
    muteExtras() { state.activeLayers.clear(); state.activeLayers.add("PIANO"); },
    setBrightness() {}, setArticulation() {}, setFxAmount() {}, setDensityGain() {},
  };
}

/** Tek elli sahte paket. */
function hand(gesture, label = "RIGHT", extra = {}) {
  const points = Array.from({ length: 21 }, (_, i) => [100 + i, 200 + i]);
  return {
    label, gesture, confidence: 0.9, openness: 0.6, pinch: 0.4,
    fingers: [true, true, true, true, true],
    landmarks: points, normalized: points.map(([x, y]) => [x / 640, y / 480, 0]),
    palmCenter: [120, 220], handSize: 90, ...extra,
  };
}

test("jest etiketi yalnizca gercek olayda yazilir, jest basili tutulurken tekrarlanmaz", () => {
  // Titremenin kaynagi buydu: jest basili tutuldugu surece her karede
  // yeni bir etiket uretiliyordu.
  const state = makeState();
  const controller = new GestureController(state, makeActions(state));

  controller.update([hand("POINT")]);
  const first = state.gestureEvent;
  assert.ok(first, "ilk girişte olay uretilmeli");

  // Ayni jest 30 kare boyunca basili: olay DEGISMEMELI.
  for (let i = 0; i < 30; i++) controller.update([hand("POINT")]);
  assert.equal(state.gestureEvent.id, first.id, "jest basili tutulurken olay tekrarlanmamali");
});

test("surekli durum metni ile sahne olayi birbirinden ayri", () => {
  const state = makeState();
  const controller = new GestureController(state, makeActions(state));

  // Iki acik avuc: gestureDetail canli sayac icerir...
  const both = [hand("OPEN_HAND", "RIGHT"), hand("OPEN_HAND", "LEFT")];
  controller.update(both);
  assert.match(state.gestureDetail, /hazırlanıyor/, "surekli durum sayac gostermeli");
  // ...ama sahne olayi bu asamada henuz yok (tetiklenmedi).
  assert.equal(state.gestureEvent, null, "tetiklenmeden olay uretilmemeli");
});

test("pinch etiketi her yuzdede degil, %10 basamaklarinda yenilenir", () => {
  const state = makeState();
  const controller = new GestureController(state, makeActions(state));

  const ids = new Set();
  // pinch 0.40 -> 0.36 arasi kucuk adimlar: yuzde surekli degisir.
  for (let p = 0.40; p > 0.36; p -= 0.002) {
    controller.update([hand("PINCH", "RIGHT", { pinch: p })]);
    if (state.gestureEvent) ids.add(state.gestureEvent.id);
  }
  // Onceki surumde her adim yeni bir etiket uretirdi (20'den fazla).
  assert.ok(ids.size <= 3, `pinch etiketi cok sik degisiyor: ${ids.size} farkli deger`);
});

test("farkli jestler ayri olaylar uretir", () => {
  const state = makeState();
  const controller = new GestureController(state, makeActions(state));

  controller.update([hand("NEUTRAL")]);
  controller.update([hand("PEACE")]);
  const drums = state.gestureEvent;
  assert.ok(drums && /Ritim/.test(drums.text));

  controller.update([hand("NEUTRAL")]);
  controller.update([hand("FIST")]);
  assert.notEqual(state.gestureEvent.id, drums.id, "yeni jest yeni olay uretmeli");
  assert.match(state.gestureEvent.text, /Yalnız piyano/);
});

test("etiket metinleri Turkce ve teknik kod icermiyor", () => {
  const state = makeState();
  const controller = new GestureController(state, makeActions(state));
  const seen = [];

  for (const gesture of ["PEACE", "FIST", "POINT", "OPEN_HAND"]) {
    controller.update([hand("NEUTRAL")]);
    controller.update([hand(gesture)]);
    if (state.gestureEvent) seen.push(state.gestureEvent.text);
  }

  assert.ok(seen.length > 0);
  for (const text of seen) {
    assert.ok(!/[A-Z]{4,}/.test(text), `teknik buyuk harf blogu var: ${text}`);
    assert.ok(!/DRUMS|STRINGS|PAD|ARMING|VOCAL SPACE/.test(text), `cevrilmemis kod adi: ${text}`);
  }
});
