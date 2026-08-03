import test from "node:test";
import assert from "node:assert/strict";
import { SynthEngine, getMeterGrid, METER_IDS } from "../../docs/js/audio/worklet/synth-engine.js";

const SAMPLE_RATE = 48000;
const MUSIC = {
  tonalSystem: "western",
  chordNotes: [60, 64, 67],
  makamDegrees: [],
  bpm: 96,
  phraseActive: false,
  chordRevision: 1,
};

/** Bir olcu boyunca hangi adimlarda hangi sesler tetiklendi? */
function scheduleBar(meterId, layers = ["PIANO", "BASS", "DRUMS"]) {
  const engine = new SynthEngine(SAMPLE_RATE);
  engine.setMeter(meterId);
  engine.setLayers(layers);
  const perStep = [];
  engine.trigger = (midi, kind, velocity = 0.7) => {
    if (velocity > 0.001) perStep[perStep.length - 1].push(kind);
  };
  const grid = getMeterGrid(meterId);
  for (let step = 0; step < grid.steps; step++) {
    perStep.push([]);
    engine._scheduleStep({ ...MUSIC, chordRevision: 1 });
  }
  return perStep;
}

test("her olcu izgarasinin adim sayisi ve kuvvetli konumlari tanimli", () => {
  for (const id of METER_IDS) {
    const grid = getMeterGrid(id);
    assert.ok(grid.steps > 0, `${id} adim sayisi`);
    assert.ok(grid.strong.length > 0, `${id} kuvvetli konum`);
    for (const list of [grid.strong, grid.weak, grid.offbeat]) {
      for (const step of list) {
        assert.ok(step >= 0 && step < grid.steps, `${id}: ${step} olcu disinda`);
      }
    }
  }
});

test("bilinmeyen olcu guvenli varsayilana duser", () => {
  assert.deepEqual(getMeterGrid("yok"), getMeterGrid("4/4"));
});

test("olcu uzunlugu gercekten degisir", () => {
  assert.equal(getMeterGrid("4/4").steps, 8);
  assert.equal(getMeterGrid("3/4").steps, 6);
  assert.equal(getMeterGrid("7/8").steps, 7);
  assert.equal(getMeterGrid("9/8").steps, 9);
  assert.equal(getMeterGrid("5/8").steps, 5);
});

test("3/4 ve 6/8 ayni adim sayisinda ama FARKLI groove uretir", () => {
  // Ikisi de 6 sekizlik. Ayirt edici olan kuvvetli konumlardir:
  // 3/4 tek kuvvetli vurus (0), 6/8 iki kuvvetli vurus (0 ve 3).
  const three = getMeterGrid("3/4");
  const six = getMeterGrid("6/8");
  assert.equal(three.steps, six.steps, "ikisi de alti sekizlik");
  assert.deepEqual(three.strong, [0]);
  assert.deepEqual(six.strong, [0, 3]);

  const threeBar = scheduleBar("3/4");
  const sixBar = scheduleBar("6/8");

  const kickSteps = (bar) => bar.map((k, i) => (k.includes("kick") ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(kickSteps(threeBar), [0], "3/4 olcude tek kick");
  assert.deepEqual(kickSteps(sixBar), [0, 3], "6/8 olcude iki kick");
});

test("aksak olculerde kuvvetli vurus tek, olcu uzunlugu farkli", () => {
  const seven = scheduleBar("7/8");
  const nine = scheduleBar("9/8");
  assert.equal(seven.length, 7);
  assert.equal(nine.length, 9);
  const kicks = (bar) => bar.filter((k) => k.includes("kick")).length;
  assert.equal(kicks(seven), 1);
  assert.equal(kicks(nine), 1);
});

test("olcu degisince adim sayaci basa doner", () => {
  const engine = new SynthEngine(SAMPLE_RATE);
  engine.trigger = () => {};
  for (let i = 0; i < 5; i++) engine._scheduleStep(MUSIC);
  assert.notEqual(engine.stepIndex, 0);
  engine.setMeter("7/8");
  assert.equal(engine.stepIndex, 0, "yeni olcu bastan baslamali");
});

test("ayni olcu tekrar secilirse sayac sifirlanmaz", () => {
  const engine = new SynthEngine(SAMPLE_RATE);
  engine.trigger = () => {};
  for (let i = 0; i < 3; i++) engine._scheduleStep(MUSIC);
  const before = engine.stepIndex;
  engine.setMeter("4/4");
  assert.equal(engine.stepIndex, before, "gereksiz sifirlama olmamali");
});

test("her olcude katman kapisi calismaya devam eder", () => {
  // Olcu degisikligi katman kontrolunu bozmamali.
  for (const id of METER_IDS) {
    const bar = scheduleBar(id, ["PIANO"]);
    const kinds = new Set(bar.flat());
    for (const kind of kinds) {
      assert.ok(/^piano/.test(kind), `${id}: yalniz piyano acikken ${kind} duyuldu`);
    }
  }
});

test("pattern indeksi olcu disina tasmaz", () => {
  // 9/8'de adim 8'e kadar cikar; sabit 8'lik pattern dizisi tasardi.
  for (const id of METER_IDS) {
    const bar = scheduleBar(id, ["PIANO", "BASS", "GITAR", "BAGLAMA", "DRUMS", "STRINGS"]);
    assert.equal(bar.length, getMeterGrid(id).steps);
    // Tetiklenen her sesin adi tanimli olmali (undefined nota olmamali).
    for (const step of bar) for (const kind of step) assert.equal(typeof kind, "string");
  }
});
