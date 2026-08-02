import test from "node:test";
import assert from "node:assert/strict";
import { SynthEngine } from "../../docs/js/audio/worklet/synth-engine.js";

const SAMPLE_RATE = 48000;

const MAKAM_MUSIC = {
  tonalSystem: "makam",
  // Hicaz benzeri kesirli dereceler: yuvarlanmadiklarini da dogrularız.
  makamDegrees: [62, 63.1, 66.9, 67, 69, 70.2, 73, 74],
  chordNotes: [62, 66, 69],
  bpm: 96,
  phraseActive: false,
  chordRevision: 1,
};

const WESTERN_MUSIC = {
  tonalSystem: "western",
  makamDegrees: [],
  chordNotes: [60, 64, 67],
  bpm: 96,
  phraseActive: false,
  chordRevision: 1,
};

/** Bir olcu (8 adim) boyunca tetiklenen seslerin turlerini toplar. */
function collectKinds(layers, music, { bars = 2, phraseActive = false } = {}) {
  const engine = new SynthEngine(SAMPLE_RATE);
  engine.setLayers(layers);
  const triggered = [];
  engine.trigger = (midiNote, kind, velocity = 0.7) => {
    if (velocity > 0.001) triggered.push({ kind, midiNote });
  };
  for (let step = 0; step < 8 * bars; step++) {
    // Her olcude akor degisimi de olsun ki chordChanged dallari da calissin.
    engine._scheduleStep({ ...music, phraseActive, chordRevision: 1 + Math.floor(step / 8) });
  }
  return triggered;
}

// Bir katman birden fazla artikulasyon sesi kullanabilir (piano/piano_soft
// ayni PIANO katmanidir). Katman sizintisini olcerken artikulasyonlari tek
// isim altinda topluyoruz.
const VOICE_TO_LAYER = {
  piano: "piano", piano_soft: "piano",
  pad: "pad", baglama: "baglama", ney: "ney", keman: "keman",
  guitar: "guitar", bass: "bass", strings: "strings", flute: "flute",
  brass: "brass", davul: "davul", kick: "drums", snare: "drums", hat: "drums",
};
const kindsOf = (triggered) =>
  [...new Set(triggered.map((t) => VOICE_TO_LAYER[t.kind] || t.kind))].sort();

test("makam modunda kapali katmanlar gercekten susar", () => {
  // Bu, brief §2D'de isaret edilen hatanin regresyon testi.
  // _scheduleMakamStep icinde pad ve baglama, layers kontrolu YAPILMADAN
  // tetikleniyordu: "Yalniz piyano" secilse bile drone ve baglama duyuluyordu.
  const kinds = kindsOf(collectKinds(["PIANO"], MAKAM_MUSIC));
  assert.ok(!kinds.includes("pad"), `PAD kapaliyken pad duyulmamali, duyulanlar: ${kinds}`);
  assert.ok(!kinds.includes("baglama"), `BAGLAMA kapaliyken baglama duyulmamali, duyulanlar: ${kinds}`);
});

test("makam modunda yalniz piyano gercekten yalniz piyano", () => {
  const kinds = kindsOf(collectKinds(["PIANO"], MAKAM_MUSIC));
  // Piyano makam modunda da bir sey calmali; sessizlik de kabul edilemez.
  assert.ok(kinds.length > 0, "yalniz piyano modunda hicbir ses yok");
  assert.deepEqual(kinds, ["piano"], `yalnizca piyano beklenirdi, duyulanlar: ${kinds}`);
});

test("makam modunda acilan katmanlar duyulur", () => {
  const kinds = kindsOf(collectKinds(["PIANO", "PAD", "BAGLAMA", "BASS"], MAKAM_MUSIC));
  for (const expected of ["pad", "baglama", "bass"]) {
    assert.ok(kinds.includes(expected), `${expected} acikken duyulmali, duyulanlar: ${kinds}`);
  }
});

test("makam dereceleri kesirli kalir, tam sayiya yuvarlanmaz", () => {
  const triggered = collectKinds(["PIANO", "PAD", "BAGLAMA", "NEY", "KEMAN"], MAKAM_MUSIC);
  const fractional = triggered.filter((t) => Math.abs(t.midiNote - Math.round(t.midiNote)) > 0.01);
  assert.ok(fractional.length > 0, "mikrotonal dereceler yuvarlanmis gorunuyor");
});

test("bati modunda kapali katmanlar gercekten susar", () => {
  const kinds = kindsOf(collectKinds(["PIANO"], WESTERN_MUSIC));
  assert.deepEqual(kinds, ["piano"], `yalnizca piyano beklenirdi, duyulanlar: ${kinds}`);
});

test("tam orkestra sonrasi kapatilan katman susar", () => {
  const engine = new SynthEngine(SAMPLE_RATE);
  engine.fullOrchestra();
  engine.muteExtras();
  const triggered = [];
  engine.trigger = (midiNote, kind, velocity = 0.7) => {
    if (velocity > 0.001) triggered.push({ kind, midiNote });
  };
  for (let step = 0; step < 16; step++) {
    engine._scheduleStep({ ...MAKAM_MUSIC, chordRevision: 1 + Math.floor(step / 8) });
  }
  const kinds = kindsOf(triggered);
  assert.deepEqual(kinds, ["piano"], `tam orkestra sonrasi susmayanlar: ${kinds}`);
});

test("her katman kendi sesini tetikler, baskasininkini degil", () => {
  // Katman -> beklenen ses turu eslemesi. Bir katman acildiginda BASKA bir
  // katmanin sesi duyulmamali.
  const cases = [
    [["PIANO", "NEY"], "ney"],
    [["PIANO", "KEMAN"], "keman"],
    [["PIANO", "DAVUL"], "davul"],
    [["PIANO", "GITAR"], "guitar"],
  ];
  for (const [layers, expected] of cases) {
    const kinds = kindsOf(collectKinds(layers, MAKAM_MUSIC));
    assert.ok(kinds.includes(expected), `${layers} -> ${expected} duyulmali, duyulanlar: ${kinds}`);
    const unexpected = kinds.filter((k) => k !== "piano" && k !== expected);
    assert.deepEqual(unexpected, [], `${layers} icin fazladan ses: ${unexpected}`);
  }
});
