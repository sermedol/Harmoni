import test from "node:test";
import assert from "node:assert/strict";
import { PhraseDetector } from "../../docs/js/harmony/phrase-detector.js";
import { WesternHarmonyEngine } from "../../docs/js/harmony/western-harmony-engine.js";

const voiced = { voiced: true, confidence: 0.9, rms: 0.05 };
const silent = { voiced: false, confidence: 0, rms: 0 };

test("short noise does not start a phrase", () => {
  const detector = new PhraseDetector();
  detector.update(voiced, 0);
  const result = detector.update(silent, 60);
  assert.equal(result.phraseActive, false);
  assert.equal(result.phraseStarted, false);
});

test("phrase attack, release and gap", () => {
  const detector = new PhraseDetector();
  detector.update(voiced, 0);
  let result = detector.update(voiced, 130);
  assert.equal(result.phraseStarted, true);
  assert.equal(result.phraseActive, true);
  detector.update(silent, 350);
  result = detector.update(silent, 640);
  assert.equal(result.phraseEnded, true);
  assert.equal(result.state, "GAP");
});

test("western auto produces a confirmed non-C harmony", () => {
  const engine = new WesternHarmonyEngine({ minEvidenceMs: 300, confirmMs: 100, changeMargin: 0.01 });
  let change = null;
  for (let i = 0; i < 30; i++) {
    const midiFloat = [67, 71, 74, 67][i % 4]; // G major material
    change = engine.update({ midiFloat, confidence: 0.95, durationMs: 180 }, i * 120) || change;
  }
  assert.ok(change);
  assert.notEqual(change.keyRoot, 0);
  assert.equal(change.chordNotes.length, 3);
  assert.equal(change.applyAtStep, 0);
});
