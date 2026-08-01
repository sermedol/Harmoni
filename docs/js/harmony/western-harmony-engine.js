const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const NAMES = ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];

function scoreScale(histogram, tonic, scale) {
  let score = 0;
  for (let pc = 0; pc < 12; pc++) score += histogram[pc] * (scale.includes((pc - tonic + 12) % 12) ? 1 : -0.42);
  score += histogram[tonic] * 0.35;
  return score;
}

export class WesternHarmonyEngine {
  constructor({ minEvidenceMs = 900, confirmMs = 700, changeMargin = 0.12 } = {}) {
    this.histogram = new Float64Array(12);
    this.minEvidenceMs = minEvidenceMs;
    this.confirmMs = confirmMs;
    this.changeMargin = changeMargin;
    this.evidenceMs = 0;
    this.current = null;
    this.candidate = null;
    this.candidateSince = 0;
    this.revision = 0;
  }

  update(stablePitch, now = performance.now()) {
    if (!stablePitch || stablePitch.confidence < 0.2 || stablePitch.durationMs < 120) return null;
    const pc = ((Math.round(stablePitch.midiFloat) % 12) + 12) % 12;
    const weight = Math.min(500, stablePitch.durationMs) * stablePitch.confidence;
    for (let i = 0; i < 12; i++) this.histogram[i] *= 0.997;
    this.histogram[pc] += weight;
    this.evidenceMs += Math.min(100, stablePitch.durationMs);
    if (this.evidenceMs < this.minEvidenceMs) return null;

    let best = null;
    let second = -Infinity;
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ["major", "minor"]) {
        const score = scoreScale(this.histogram, tonic, mode === "major" ? MAJOR : MINOR);
        if (!best || score > best.score) { second = best?.score ?? second; best = { tonic, mode, score }; }
        else if (score > second) second = score;
      }
    }
    const confidence = best.score > 0 ? Math.max(0, Math.min(1, (best.score - second) / best.score)) : 0;
    const id = `${best.tonic}:${best.mode}`;
    if (this.current?.id === id) return null;
    if (confidence < this.changeMargin) return null;
    if (this.candidate?.id !== id) { this.candidate = { ...best, id, confidence }; this.candidateSince = now; return null; }
    if (now - this.candidateSince < this.confirmMs) return null;

    const rootMidi = 60 + best.tonic;
    const third = best.mode === "major" ? 4 : 3;
    this.current = { ...best, id, confidence };
    this.revision += 1;
    return {
      type: "harmony-change",
      revision: this.revision,
      chordNotes: [rootMidi, rootMidi + third, rootMidi + 7],
      chordName: `${NAMES[best.tonic]} ${best.mode === "major" ? "Majör" : "Minör"}`,
      functionName: "I",
      keyRoot: best.tonic,
      mode: best.mode,
      confidence,
      applyAtStep: 0,
    };
  }
}
