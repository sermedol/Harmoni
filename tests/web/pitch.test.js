import test from "node:test";
import assert from "node:assert/strict";
import { PitchTracker } from "../../docs/js/audio/worklet/pitch-tracker.js";

function feed(tracker, frequency, { amplitude = 0.12, blocks = 100, noise = 0 } = {}) {
  let result;
  let phase = 0;
  for (let block = 0; block < blocks; block++) {
    const samples = new Float64Array(128);
    for (let i = 0; i < samples.length; i++, phase++) {
      const tone = frequency ? Math.sin(2 * Math.PI * frequency * phase / 48000) * amplitude : 0;
      samples[i] = tone + (Math.random() * 2 - 1) * noise;
    }
    result = tracker.submit(samples, block * 128 / 48);
  }
  return result;
}

test("silence is not voiced", () => {
  const result = feed(new PitchTracker(48000), 0);
  assert.equal(result.voiced, false);
});

for (const frequency of [110, 220, 440, 880]) {
  test(`${frequency} Hz accuracy`, () => {
    const tracker = new PitchTracker(48000);
    const result = feed(tracker, frequency);
    assert.equal(result.voiced, true);
    assert.ok(Math.abs(result.frequency - frequency) < 3, `${result.frequency} Hz`);
    assert.ok(tracker.stablePitch?.durationMs >= 160);
  });
}

test("white noise is rejected", () => {
  const result = feed(new PitchTracker(48000), 0, { noise: 0.025 });
  assert.equal(result.voiced, false);
});
