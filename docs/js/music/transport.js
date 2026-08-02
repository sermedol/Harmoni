// Transport — sample clock tabanli zaman yonetimi.
//
// Tek zaman kaynagi AudioWorklet'in orneklem sayacidir. Date.now(),
// requestAnimationFrame veya DOM zamani KULLANILMAZ: bunlar ses ipliginden
// bagimsiz kayar ve uzun kayitlarda senkron bozulur.
//
// Onceki sistemde yalnizca `samplesToStep` sayaci vardi; olcu, vurus ve
// downbeat kavrami yoktu. Bu yuzden "bir sonraki olcu basinda uygula" gibi
// muzikal bir sinir ifade edilemiyordu.

import { getMeter } from "./meter.js";

export const QUANTIZE = {
  IMMEDIATE: "immediate",
  NEXT_SUBDIVISION: "nextSubdivision",
  NEXT_BEAT: "nextBeat",
  NEXT_BAR: "nextBar",
};

export class Transport {
  constructor({ sampleRate = 48000, bpm = 96, meter = "4/4" } = {}) {
    this.sampleRate = sampleRate;
    this.bpm = bpm;
    this.meter = typeof meter === "string" ? getMeter(meter) : meter;

    this.absoluteSample = 0;
    this.absoluteTick = 0;      // baslangictan beri gecen tick sayisi
    this.samplesIntoTick = 0;
    this.playing = true;

    // Bekleyen degisiklikler muzikal sinirda uygulanir.
    this.pendingTempo = null;
    this.pendingMeter = null;
  }

  get samplesPerTick() {
    return this.meter.secondsPerTick(this.bpm) * this.sampleRate;
  }

  /** Olcu icindeki tick konumu. */
  get tickInBar() {
    const ticks = this.meter.ticksPerBar;
    return ((this.absoluteTick % ticks) + ticks) % ticks;
  }

  get barIndex() {
    return Math.floor(this.absoluteTick / this.meter.ticksPerBar);
  }

  get beatIndex() {
    return this.meter.groupIndexAt(this.tickInBar);
  }

  get barPhase() {
    return this.tickInBar / this.meter.ticksPerBar;
  }

  /**
   * Tempo degisimi. Faz surekliligini korur: absoluteSample sifirlanmaz,
   * yalnizca bir sonraki tick'in uzunlugu degisir.
   */
  setTempo(bpm, when = QUANTIZE.NEXT_BEAT) {
    const value = Math.min(300, Math.max(20, bpm));
    if (when === QUANTIZE.IMMEDIATE) {
      this.bpm = value;
      this.pendingTempo = null;
      return;
    }
    this.pendingTempo = { value, when };
  }

  /** Olcu degisimi yalnizca olcu basinda uygulanir. */
  setMeter(meter, when = QUANTIZE.NEXT_BAR) {
    const resolved = typeof meter === "string" ? getMeter(meter) : meter;
    if (when === QUANTIZE.IMMEDIATE) {
      this.meter = resolved;
      this.absoluteTick = 0;
      this.samplesIntoTick = 0;
      this.pendingMeter = null;
      return;
    }
    this.pendingMeter = { value: resolved };
  }

  /** Verilen kuantize kipine gore kac tick sonra sinira varilir. */
  ticksUntil(when) {
    const ticksPerBar = this.meter.ticksPerBar;
    switch (when) {
      case QUANTIZE.IMMEDIATE:
        return 0;
      case QUANTIZE.NEXT_SUBDIVISION:
        return 1;
      case QUANTIZE.NEXT_BEAT: {
        const position = this.tickInBar;
        for (const start of this.meter.groupStarts) {
          if (start > position) return start - position;
        }
        return ticksPerBar - position;
      }
      case QUANTIZE.NEXT_BAR:
        return ticksPerBar - this.tickInBar;
      default:
        return 0;
    }
  }

  /**
   * Zamani ilerletir ve gecilen her tick icin callback cagirir.
   * Callback'e verilen bilgi ile ritim motoru olay uretir.
   *
   * @param {number} sampleCount ilerletilecek orneklem sayisi (quantum)
   * @param {(tick: object) => void} onTick
   */
  advance(sampleCount, onTick) {
    if (!this.playing) {
      this.absoluteSample += sampleCount;
      return;
    }

    let remaining = sampleCount;
    while (remaining > 0) {
      const samplesPerTick = this.samplesPerTick;
      const untilNextTick = samplesPerTick - this.samplesIntoTick;

      if (remaining < untilNextTick) {
        this.samplesIntoTick += remaining;
        this.absoluteSample += remaining;
        remaining = 0;
        break;
      }

      // Tick siniri: once konumu ilerlet, sonra bekleyenleri uygula.
      this.absoluteSample += untilNextTick;
      remaining -= untilNextTick;
      this.samplesIntoTick = 0;
      this.absoluteTick += 1;

      this._applyPending();

      if (onTick) {
        onTick({
          tick: this.absoluteTick,
          tickInBar: this.tickInBar,
          barIndex: this.barIndex,
          beatIndex: this.beatIndex,
          isDownbeat: this.meter.isDownbeat(this.tickInBar),
          isBeatStart: this.meter.isBeatStart(this.tickInBar),
          accent: this.meter.accentAt(this.tickInBar),
          meter: this.meter,
          bpm: this.bpm,
          sample: this.absoluteSample,
        });
      }
    }
  }

  _applyPending() {
    const atBarStart = this.tickInBar === 0;

    if (this.pendingMeter && atBarStart) {
      this.meter = this.pendingMeter.value;
      this.pendingMeter = null;
      // Olcu degisince tick sayacini olcu basina hizala.
      this.absoluteTick = 0;
    }

    if (this.pendingTempo) {
      const { when } = this.pendingTempo;
      const ready = when === QUANTIZE.NEXT_BAR
        ? atBarStart
        : this.meter.isBeatStart(this.tickInBar);
      if (ready) {
        this.bpm = this.pendingTempo.value;
        this.pendingTempo = null;
      }
    }
  }

  reset() {
    this.absoluteSample = 0;
    this.absoluteTick = 0;
    this.samplesIntoTick = 0;
    this.pendingTempo = null;
    this.pendingMeter = null;
  }
}

/**
 * Tap tempo — son vuruslardan saglam bir BPM cikarir.
 * Medyan kullanilir: tek bir gec/erken vurus ortalamayi bozmasin.
 */
export function createTapTempo({ maxTaps = 8, minBpm = 40, maxBpm = 220 } = {}) {
  let taps = [];
  return {
    /** @returns {number|null} yeterli veri yoksa null */
    tap(timeMs) {
      if (taps.length && timeMs - taps[taps.length - 1] > 3000) taps = [];
      taps.push(timeMs);
      if (taps.length > maxTaps) taps.shift();
      if (taps.length < 3) return null;

      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      intervals.sort((a, b) => a - b);

      // Medyan + aykiri temizleme: medyandan %40'tan fazla sapanlar atilir.
      const median = intervals[Math.floor(intervals.length / 2)];
      const kept = intervals.filter((value) => Math.abs(value - median) <= median * 0.4);
      if (!kept.length) return null;
      const average = kept.reduce((a, b) => a + b, 0) / kept.length;

      const bpm = 60000 / average;
      if (bpm < minBpm || bpm > maxBpm) return null;
      return Math.round(bpm);
    },
    reset() { taps = []; },
    get count() { return taps.length; },
  };
}
