// harmoni.py SynthEngine._render_voice - 12+ enstruman sentez algoritmasinin
// birebir portu. Python numpy ile tum bloğu vektorize eder; burada dogal JS
// karsiligi olarak orneklem-basi (per-sample) dongu kullanilir (128-256
// orneklik bloklarda onemsiz maliyet).
import { midiToFrequency, mulberry32 } from "../../constants/music-utils.js";
import { karplusStrongPluck } from "./karplus-strong.js";

// numpy'nin rng.standard_normal(n) ile ayni ROLU oynayan (bit-esdegeri degil,
// deterministik/tekrarlanabilir) Gauss gurultusu - Box-Muller donusumu.
function gaussianArray(seed, n) {
  const rand = mulberry32(seed >>> 0);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    let u1 = rand();
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    out[i] = r * Math.cos(theta);
    if (i + 1 < n) out[i + 1] = r * Math.sin(theta);
  }
  return out;
}

const TWO_PI = 2 * Math.PI;

/**
 * voice: { midiNote, kind, velocity, durationSamples, pan, phase, ageSamples,
 *          seed, ksBuffer, ksPos }
 * Donen deger: [leftFloat32Array, rightFloat32Array]. voice.phase ve
 * voice.ageSamples yerinde (in-place) guncellenir (Python'daki gibi).
 */
export function renderVoice(voice, frames, sampleRate) {
  const frequency = midiToFrequency(voice.midiNote);
  voice._frequency = frequency; // karplusStrongPluck n_delay hesaplamasi icin
  const phaseStep = (TWO_PI * frequency) / sampleRate;
  const startAge = voice.ageSamples;
  const detuneUnit = ((voice.seed % 9973) / 9973.0) - 0.5;

  const signal = new Float64Array(frames);
  const env = new Float64Array(frames);

  const kind = voice.kind;
  let noise = null;
  if (["piano", "keman", "flute", "ney", "kick", "snare", "hat", "davul"].includes(kind)) {
    noise = gaussianArray((voice.seed + startAge) >>> 0, frames);
  }

  if (kind === "piano" || kind === "piano_soft") {
    const decayRate = kind === "piano" ? 4.1 : 2.5;
    const detuneRatio = Math.pow(2, (3.2 * detuneUnit) / 1200);
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const phase = voice.phase + phaseStep * i;
      const attack = Math.min(1, age / 0.01);
      env[i] = attack * Math.exp(-age * decayRate);
      const fundamental = 0.55 * Math.sin(phase) + 0.45 * Math.sin(phase * detuneRatio);
      let s = (fundamental
        + 0.30 * Math.sin(phase * 2.005 + 0.2)
        + 0.14 * Math.sin(phase * 3.99 + 0.5)
        + 0.06 * Math.sin(phase * 6.02 + 0.9)) / 1.60;
      if (kind === "piano") {
        const hammerEnv = Math.exp(-age * 600.0);
        s += 0.05 * hammerEnv * noise[i];
      }
      signal[i] = s;
    }
  } else if (kind === "bass") {
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const phase = voice.phase + phaseStep * i;
      env[i] = Math.min(1, age / 0.018) * Math.exp(-age * 3.0);
      const raw = 0.86 * Math.sin(phase) + 0.14 * Math.sin(phase * 2.0);
      signal[i] = Math.tanh(raw * 1.4) / Math.tanh(1.4);
    }
  } else if (kind === "strings" || kind === "pad") {
    const attackTime = kind === "strings" ? 0.32 : 0.62;
    const releaseTime = 0.62;
    const durationSec = voice.durationSamples / sampleRate;
    const detuneRatio = Math.pow(2, (5.0 * detuneUnit) / 1200);
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const t = age;
      const phase = voice.phase + phaseStep * i;
      env[i] = Math.min(1, age / attackTime) * Math.min(1, Math.max(0, durationSec - age) / releaseTime);
      const vibrato = 0.0025 * Math.sin(TWO_PI * 4.8 * t);
      const phaseV = phase + vibrato;
      const phaseV2 = phase * detuneRatio + vibrato * 1.08;
      let harm = 0, harm2 = 0;
      for (let h = 1; h <= 4; h++) {
        harm += (1 / h) * Math.sin(phaseV * h);
        harm2 += (1 / h) * Math.sin(phaseV2 * h);
      }
      let s = (0.6 * harm + 0.4 * harm2) / 1.95;
      if (kind === "pad") s = 0.72 * s + 0.28 * Math.sin(phase * 0.5);
      signal[i] = s;
    }
  } else if (kind === "baglama" || kind === "guitar") {
    let decayLow, decayHigh, burstTone;
    if (kind === "guitar") {
      decayLow = 0.9975; decayHigh = 0.9955; burstTone = 0.7;
    } else {
      decayLow = 0.9965; decayHigh = 0.9935; burstTone = 0.5;
    }
    const ks = karplusStrongPluck(voice, frames, sampleRate, decayLow, decayHigh, burstTone);
    for (let i = 0; i < frames; i++) {
      signal[i] = ks[i];
      env[i] = 1.0;
    }
  } else if (kind === "keman") {
    const attackTime = 0.16, releaseTime = 0.4;
    const durationSec = voice.durationSamples / sampleRate;
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const t = age;
      const phase = voice.phase + phaseStep * i;
      env[i] = Math.min(1, age / attackTime) * Math.min(1, Math.max(0, durationSec - age) / releaseTime);
      const vibratoDepth = Math.min(1, age / 0.35) * 0.006;
      const vibrato = vibratoDepth * Math.sin(TWO_PI * 5.2 * t);
      const phaseV = phase + vibrato;
      const bowNoise = noise[i] * 0.02 * Math.exp(-age * 12.0);
      let harm = 0;
      for (let h = 1; h <= 5; h++) harm += (1 / h) * Math.sin(phaseV * h);
      signal[i] = harm / 2.28 + bowNoise;
    }
  } else if (kind === "davul") {
    const highNote = voice.midiNote >= 60;
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const t = age;
      if (highNote) {
        env[i] = Math.exp(-age * 60.0);
        signal[i] = 0.6 * noise[i] * Math.exp(-age * 140.0) + 0.4 * Math.sin(TWO_PI * 320.0 * t);
      } else {
        env[i] = Math.exp(-age * 12.0);
        const swept = TWO_PI * (55.0 * age + 30.0 * (1.0 - Math.exp(-age * 10.0)));
        signal[i] = Math.sin(swept);
      }
    }
  } else if (kind === "flute") {
    const attackTime = 0.12, releaseTime = 0.35;
    const durationSec = voice.durationSamples / sampleRate;
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const t = age;
      const phase = voice.phase + phaseStep * i;
      env[i] = Math.min(1, age / attackTime) * Math.min(1, Math.max(0, durationSec - age) / releaseTime);
      const vibrato = 0.004 * Math.sin(TWO_PI * 5.5 * t);
      const phaseV = phase + vibrato;
      const breath = noise[i] * 0.045;
      signal[i] = (Math.sin(phaseV) + 0.08 * Math.sin(phaseV * 2.0) + 0.03 * Math.sin(phaseV * 3.0)) / 1.11 + breath;
    }
  } else if (kind === "brass") {
    const attackTime = 0.09, releaseTime = 0.28;
    const durationSec = voice.durationSamples / sampleRate;
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const phase = voice.phase + phaseStep * i;
      env[i] = Math.pow(Math.min(1, age / attackTime), 1.5) * Math.min(1, Math.max(0, durationSec - age) / releaseTime);
      let raw = 0;
      for (let h = 1; h <= 6; h++) raw += (1 / h) * Math.sin(phase * h);
      raw /= 2.45;
      signal[i] = Math.tanh(raw * 1.6) / Math.tanh(1.6);
    }
  } else if (kind === "ney") {
    const attackTime = 0.18, releaseTime = 0.5;
    const durationSec = voice.durationSamples / sampleRate;
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const t = age;
      const phase = voice.phase + phaseStep * i;
      env[i] = Math.min(1, age / attackTime) * Math.min(1, Math.max(0, durationSec - age) / releaseTime);
      const breathEnv = Math.exp(-age * 6.0) * 0.35 + 0.06;
      const breath = noise[i] * breathEnv;
      const vibrato = 0.0035 * Math.sin(TWO_PI * 4.2 * t);
      const phaseV = phase + vibrato;
      signal[i] = (Math.sin(phaseV) + 0.18 * Math.sin(phaseV * 2.0 + 0.3)) / 1.18 + breath;
    }
  } else if (kind === "kick") {
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      env[i] = Math.exp(-age * 23.0);
      const swept = TWO_PI * (50.0 * age + 43.0 * (1.0 - Math.exp(-age * 19.0)));
      const clickEnv = Math.exp(-age * 900.0);
      signal[i] = Math.sin(swept) + 0.18 * clickEnv * noise[i];
    }
  } else if (kind === "snare") {
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const phase = voice.phase + phaseStep * i;
      env[i] = Math.exp(-age * 29.0);
      signal[i] = 0.74 * noise[i] + 0.26 * Math.sin(phase * 0.42);
    }
  } else if (kind === "hat") {
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      env[i] = Math.exp(-age * 52.0);
      const prev = i === 0 ? noise[0] : noise[i - 1];
      signal[i] = noise[i] - prev;
    }
  } else {
    for (let i = 0; i < frames; i++) {
      const age = (startAge + i) / sampleRate;
      const phase = voice.phase + phaseStep * i;
      env[i] = Math.exp(-age * 3.0);
      signal[i] = Math.sin(phase);
    }
  }

  // Notanin kesildigi anda ani kesilmeyi (click) onlemek icin ~12ms sonme rampasi.
  const releaseSamples = Math.max(1.0, 0.012 * sampleRate);
  const leftGain = Math.sqrt((1.0 - voice.pan) * 0.5);
  const rightGain = Math.sqrt((1.0 + voice.pan) * 0.5);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const n = startAge + i;
    const remaining = voice.durationSamples - n;
    const tailFade = Math.min(1, Math.max(0, remaining / releaseSamples));
    const out = signal[i] * env[i] * tailFade * voice.velocity;
    left[i] = out * leftGain;
    right[i] = out * rightGain;
  }

  voice.phase = (voice.phase + phaseStep * frames) % TWO_PI;
  voice.ageSamples += frames;
  return [left, right];
}
