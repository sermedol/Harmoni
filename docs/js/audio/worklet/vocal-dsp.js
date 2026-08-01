// harmoni.py VocalDSP.process - 14 adimlik zincirin birebir portu (HPF ->
// gate -> compressor -> presence -> warmth -> [devre disiysa erken donus] ->
// reverb -> echo -> geri besleme yumusatma -> gecikme hatti yazimi -> wet/dry
// karisim -> output gain -> yumusak limiter -> clip).
import { onePoleLowpass, lerp, clamp } from "../../constants/music-utils.js";
import { MultiTapReverb } from "./multitap-reverb.js";

// gate_speed (0.22/0.06) ve compressor katsayilari (0.30/0.07) Python'da
// AUDIO_BLOCK=256 orneklik blok basina BIR KEZ uygulanan ustel yumusatmalardir
// (butun blok boyunca tek bir skaler kazanc). AudioWorklet quantum'u sabit
// 128 oldugundan, ayni gercek-zamanli hiz icin 1-sqrt(1-k) ile yari-blok-
// basina uyarlanir (bkz. synth-engine.js'teki ayni teknik - DUCK_RATE).
function halfBlockRate(k) {
  return 1 - Math.sqrt(1 - k);
}

export class VocalDSP {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.enabled = true;
    this.noiseReduction = 0.30;
    this.compression = 0.42;
    this.clarity = 0.19;
    this.warmth = 0.17;
    this.reverbMix = 0.16;
    this.echoMix = 0.055;
    this.outputGain = 0.82;

    this.lowState = 0.0;
    this.compGain = 1.0;
    this.gateGain = 1.0;

    this.reverb = new MultiTapReverb(sampleRate, {
      tapsL: [0.037, 0.071, 0.113, 0.167],
      gainsL: [0.44, 0.31, 0.22, 0.16],
      tapsR: [0.043, 0.079, 0.131, 0.181],
      gainsR: [0.42, 0.30, 0.23, 0.15],
      feedbackAmount: 0.36,
      echoFeedbackAmount: 0.09,
      smoothingCoeff: 0.77,
      bufferSeconds: 2.2,
      echoTapL: 0.118,
      echoTapR: 0.118 * 1.07,
    });
  }

  // Pinch jesti: reverb_mix in [0.05,0.24], echo_mix in [0.01,0.095].
  setFxAmount(amount) {
    const a = clamp(amount, 0, 1);
    this.reverbMix = lerp(0.05, 0.24, a);
    this.echoMix = lerp(0.01, 0.095, a);
  }

  /** @param {Float32Array|Float64Array} mono @returns {[Float32Array, Float32Array]} */
  process(mono) {
    const frames = mono.length;
    if (frames === 0) return [new Float32Array(0), new Float32Array(0)];

    // 1) ~80Hz high-pass (LP cikarimi ile, tek kutuplu).
    const cutoff = 80.0;
    const alpha = Math.exp((-2.0 * Math.PI * cutoff) / this.sampleRate);
    const x64 = mono instanceof Float64Array ? mono : Float64Array.from(mono);
    const [low, newLowState] = onePoleLowpass(x64, alpha, this.lowState);
    this.lowState = newLowState;
    const hp = new Float64Array(frames);
    for (let i = 0; i < frames; i++) hp[i] = x64[i] - low[i];

    // 2) Noise gate (blok RMS'ine gore).
    let sumSq = 0;
    for (let i = 0; i < frames; i++) sumSq += hp[i] * hp[i];
    const rms = Math.sqrt(sumSq / frames + 1e-12);
    const gateThreshold = lerp(0.0018, 0.010, this.noiseReduction);
    const targetGate = rms >= gateThreshold ? 1.0 : 0.18;
    const gateSpeed = halfBlockRate(targetGate > this.gateGain ? 0.22 : 0.06);
    this.gateGain += (targetGate - this.gateGain) * gateSpeed;
    const clean = new Float64Array(frames);
    for (let i = 0; i < frames; i++) clean[i] = hp[i] * this.gateGain;

    // 3) Blok tabanli compressor.
    const threshold = lerp(0.18, 0.055, this.compression);
    const ratio = lerp(1.4, 3.4, this.compression);
    let peak = 0;
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(clean[i]));
    peak += 1e-9;
    const targetCompGain = peak > threshold ? (threshold + (peak - threshold) / ratio) / peak : 1.0;
    const compCoeff = halfBlockRate(targetCompGain < this.compGain ? 0.30 : 0.07);
    this.compGain += (targetCompGain - this.compGain) * compCoeff;
    for (let i = 0; i < frames; i++) clean[i] *= this.compGain;

    // 4) Presence (ilk-fark vurgusu) + 5) warmth (yumusak doygunluk).
    const warmed = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      const prev = i === 0 ? clean[0] : clean[i - 1];
      const presence = clean[i] - prev;
      const withPresence = clean[i] + presence * this.clarity * 0.18;
      warmed[i] = Math.tanh(withPresence * (1.0 + this.warmth * 0.55)) / (1.0 + this.warmth * 0.30);
    }

    if (!this.enabled) {
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const v = clamp(warmed[i] * this.outputGain, -0.96, 0.96);
        left[i] = v;
        right[i] = v;
      }
      return [left, right];
    }

    // 6-10) Reverb + echo + geri besleme + gecikme hatti yazimi (paylasilan sinif).
    const { wetL, wetR, echoL, echoR } = this.reverb.process(warmed, warmed);

    // 11-14) Wet/dry karisim, output gain, yumusak limiter, clip.
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let l = (warmed[i] + wetL[i] * this.reverbMix + echoL[i] * this.echoMix) * this.outputGain;
      let r = (warmed[i] + wetR[i] * this.reverbMix + echoR[i] * this.echoMix) * this.outputGain;
      l = Math.tanh(l * 1.18) / Math.tanh(1.18);
      r = Math.tanh(r * 1.18) / Math.tanh(1.18);
      left[i] = clamp(l, -0.96, 0.96);
      right[i] = clamp(r, -0.96, 0.96);
    }
    return [left, right];
  }
}
