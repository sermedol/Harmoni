// harmoni.py PitchTracker - FFT-otokorelasyon tabanli monofonik pitch takibi,
// birebir port. Python'da ayri bir thread'de calisir (ses callback'inden
// kuyruklama ile beslenir); worklet zaten kendi ozel ses-render thread'inde
// oldugundan (bkz. plan: snuggly-chasing-spindle.md #1.1) burada dogrudan
// process() icinde calistirilir - ayni "gercek-zamanli, ana/UI thread'den
// bagimsiz" ozelligi zaten saglanmis olur.
import { frequencyToMidi, midiToFrequency, midiToName } from "../../constants/music-utils.js";
import { autocorrelateFFT } from "./fft.js";

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function hanningWindow(n) {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// numpy'nin np.unique (sirali, kucukten buyuge) + argmax(counts) davranisini
// birebir taklit eder: en cok tekrar eden deger; esitlikte EN KUCUK deger kazanir.
function modeLowestTieBreak(arr) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  const uniqueSorted = [...counts.keys()].sort((a, b) => a - b);
  let best = uniqueSorted[0];
  let bestCount = -1;
  for (const v of uniqueSorted) {
    const c = counts.get(v);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

function defaultSnapshot(rms, confidence, timestamp) {
  return {
    frequency: 0, midiNote: -1, noteName: "--", confidence, rms, cents: 0, voiced: false, timestamp,
  };
}

export class PitchTracker {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.buffer = new Float64Array(8192);
    this.writeCount = 0;
    this.frequencyHistory = [];
    this.noteHistory = [];
    this.lastSnapshot = defaultSnapshot(0, 0, 0);
  }

  // mono: Float64Array (bu blogun ham mikrofon orneklegi).
  submit(mono, now) {
    const n = mono.length;
    if (n >= this.buffer.length) {
      this.buffer.set(mono.subarray(mono.length - this.buffer.length));
    } else {
      this.buffer.copyWithin(0, n);
      this.buffer.set(mono, this.buffer.length - n);
    }
    this.writeCount += n;
    if (this.writeCount < 1024) return this.lastSnapshot;
    this.writeCount = 0;
    this.lastSnapshot = this.detect(this.buffer.subarray(this.buffer.length - 3072), now);
    return this.lastSnapshot;
  }

  detect(samplesIn, now) {
    const n = samplesIn.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += samplesIn[i];
    mean /= n;
    const x = new Float64Array(n);
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      x[i] = samplesIn[i] - mean;
      sumSq += x[i] * x[i];
    }
    const rms = Math.sqrt(sumSq / n + 1e-12);
    // Dizüstü/telefon mikrofonlarında sakin vokali de yakala; düşük güven
    // eşiği tek başına ortam gürültüsünün nota sayılmasını engeller.
    if (rms < 0.0022) {
      this.frequencyHistory.length = 0;
      this.noteHistory.length = 0;
      return defaultSnapshot(rms, 0, now);
    }

    const window = hanningWindow(n);
    for (let i = 0; i < n; i++) x[i] *= window[i];

    const nFft = nextPow2(2 * n - 1);
    const padded = new Float64Array(nFft);
    padded.set(x);
    const corrFull = autocorrelateFFT(padded);
    const corr = corrFull.subarray(0, n);
    const zero = Math.max(corr[0], 1e-12);

    const minFreq = 70.0;
    const maxFreq = 1100.0;
    const minLag = Math.max(2, Math.floor(this.sampleRate / maxFreq));
    const maxLag = Math.min(corr.length - 2, Math.floor(this.sampleRate / minFreq));
    if (maxLag <= minLag) return defaultSnapshot(rms, 0, now);
    const local = corr.subarray(minLag, maxLag);
    if (local.length === 0) return defaultSnapshot(rms, 0, now);

    const peaks = [];
    for (let i = 1; i < local.length - 1; i++) {
      if (local[i] > local[i - 1] && local[i] >= local[i + 1]) peaks.push(i + minLag);
    }
    let lag;
    if (peaks.length === 0) {
      let bestIdx = 0;
      for (let i = 1; i < local.length; i++) if (local[i] > local[bestIdx]) bestIdx = i;
      lag = bestIdx + minLag;
    } else {
      const peakValues = peaks.map((p) => corr[p]);
      const globalPeak = Math.max(...peakValues);
      const eligible = peaks.filter((p, idx) => peakValues[idx] >= globalPeak * 0.82);
      if (eligible.length) {
        lag = Math.min(...eligible);
      } else {
        let bestIdx = 0;
        for (let i = 1; i < peakValues.length; i++) if (peakValues[i] > peakValues[bestIdx]) bestIdx = i;
        lag = peaks[bestIdx];
      }
    }

    if (lag >= 1 && lag < corr.length - 1) {
      const y0 = corr[lag - 1];
      const y1 = corr[lag];
      const y2 = corr[lag + 1];
      const denom = y0 - 2.0 * y1 + y2;
      if (Math.abs(denom) > 1e-12) lag = lag + (0.5 * (y0 - y2)) / denom;
    }

    const frequency = this.sampleRate / Math.max(lag, 1.0);
    const confidence = Math.max(0, Math.min(1, corr[Math.round(lag)] / zero));
    if (frequency < minFreq || frequency > maxFreq || confidence < 0.20) {
      return defaultSnapshot(rms, confidence, now);
    }

    this.frequencyHistory.push(frequency);
    if (this.frequencyHistory.length > 5) this.frequencyHistory.shift();
    const smoothFrequency = median(this.frequencyHistory);
    const midiFloat = frequencyToMidi(smoothFrequency);
    let midiNote = Math.round(midiFloat);
    this.noteHistory.push(midiNote);
    if (this.noteHistory.length > 5) this.noteHistory.shift();
    midiNote = modeLowestTieBreak(this.noteHistory);
    const cents = 1200.0 * Math.log2(smoothFrequency / midiToFrequency(midiNote));

    return {
      frequency: smoothFrequency,
      midiNote,
      noteName: midiToName(midiNote, true),
      confidence,
      rms,
      cents,
      voiced: true,
      timestamp: now,
    };
  }
}
