export const PHRASE_STATES = Object.freeze({ SILENT: "SILENT", ATTACK: "ATTACK", ACTIVE: "ACTIVE", RELEASE: "RELEASE", GAP: "GAP" });

export class PhraseDetector {
  constructor({ attackMs = 110, releaseMs = 260, gapMs = 720, minActiveMs = 180 } = {}) {
    this.attackMs = attackMs;
    this.releaseMs = releaseMs;
    this.gapMs = gapMs;
    this.minActiveMs = minActiveMs;
    this.state = PHRASE_STATES.SILENT;
    this.stateSince = 0;
    this.phraseStartedAt = 0;
  }

  update(pitch, now = performance.now()) {
    const reliable = !!pitch?.voiced && (pitch.confidence || 0) >= 0.2 && (pitch.rms || 0) >= 0.0022;
    let phraseStarted = false;
    let phraseEnded = false;
    const elapsed = now - this.stateSince;
    if (this.state === PHRASE_STATES.SILENT && reliable) this._enter(PHRASE_STATES.ATTACK, now);
    else if (this.state === PHRASE_STATES.ATTACK) {
      if (!reliable) this._enter(PHRASE_STATES.SILENT, now);
      else if (elapsed >= this.attackMs) { this._enter(PHRASE_STATES.ACTIVE, now); this.phraseStartedAt = now; phraseStarted = true; }
    } else if (this.state === PHRASE_STATES.ACTIVE && !reliable) this._enter(PHRASE_STATES.RELEASE, now);
    else if (this.state === PHRASE_STATES.RELEASE) {
      if (reliable) this._enter(PHRASE_STATES.ACTIVE, now);
      else if (elapsed >= this.releaseMs && now - this.phraseStartedAt >= this.minActiveMs) { this._enter(PHRASE_STATES.GAP, now); phraseEnded = true; }
    } else if (this.state === PHRASE_STATES.GAP) {
      if (reliable) this._enter(PHRASE_STATES.ATTACK, now);
      else if (elapsed >= this.gapMs) this._enter(PHRASE_STATES.SILENT, now);
    }
    return {
      state: this.state,
      phraseActive: this.state === PHRASE_STATES.ATTACK || this.state === PHRASE_STATES.ACTIVE || this.state === PHRASE_STATES.RELEASE,
      phraseStarted,
      phraseEnded,
      gapDurationMs: this.state === PHRASE_STATES.GAP ? now - this.stateSince : 0,
      confidence: reliable ? pitch.confidence : 0,
    };
  }

  _enter(next, now) { this.state = next; this.stateSince = now; }
}
