// Vokal islem zinciri - studyo dublaj kanali mantigi.
//
//   giris kazanci
//     -> 80 Hz yuksek geciren (biquad)
//     -> gurultu kapisi (dB esikli, ms zaman sabitli, kismi kapanma)
//     -> EQ: 300 Hz camur kesme / 3.2 kHz netlik / 9 kHz hava
//     -> kompresor (yumusak diz, -18 dB, 3:1, 15 ms atak, 140 ms release)
//     -> hafif doygunluk (warmth)
//     -> reverb (RT60 ile parametrize) + kisa stereo delay
//     -> wet/dry karisim
//     -> tepe limitleyici (-1 dBFS)
//     -> cikis kazanci
//
// ONCEKI SURUMDEN FARKLAR ve nedenleri:
//
// 1) Yuksek geciren artik gercek 2. derece biquad. Onceki surum tek kutuplu
//    alcak gecirenin cikarimiydi (x - lowpass(x)); bu yalnizca 6 dB/oktav
//    egim verir ve 80 Hz'in altindaki gurultuyu yeterince bastirmaz.
//
// 2) "Presence" adimi ilk-fark (x[n]-x[n-1]) vurgusuydu. Bu, frekansla
//    surekli yukselen bir egimdir: netligi acarken tislama ve mikrofon
//    gurultusunu de ayni oranda kaldirir. Yerine yalnizca hedef bandi
//    etkileyen tepe filtreleri kondu.
//
// 3) Kapi ve kompresor blok RMS/tepe degerine gore, blok basina TEK bir
//    skaler kazancla calisiyordu. Bu, atak/release surelerinin blok
//    boyutuna bagli olmasi demekti. Artik ikisi de orneklem basina
//    zarf takipcisi kullaniyor ve zaman sabitleri milisaniye cinsinden
//    verilebiliyor.
//
// 4) Reverb geri beslemesi sabit bir katsayiydi. Artik hedef RT60'tan
//    hesaplaniyor, yani "sonme suresi" saniye cinsinden ayarlanabiliyor.
import { lerp, clamp } from "../../constants/music-utils.js";
import { MultiTapReverb } from "./multitap-reverb.js";
import { Biquad, BiquadChain, highpassCoefficients, peakingCoefficients, highShelfCoefficients } from "./biquad.js";

const TINY = 1e-9;

function dbToLinear(db) { return Math.pow(10, db / 20); }
function linearToDb(linear) { return 20 * Math.log10(Math.abs(linear) + TINY); }

/** Zarf takipcisi katsayisi: verilen surede e-katina yaklasim. */
export function timeConstant(seconds, sampleRate) {
  if (!(seconds > 0)) return 0;
  return Math.exp(-1 / (seconds * sampleRate));
}

/**
 * Geri besleme kazancini hedef sonme suresinden (RT60) hesaplar.
 * Ortalama vurus gecikmesi d olan bir geri beslemeli agda sinyal her d
 * saniyede g katina duser; 60 dB dusus icin g = 10^(-3d/RT60).
 * Kararlilik icin ust sinir uygulanir.
 */
export function feedbackForDecay(decaySeconds, meanTapSeconds, maxFeedback = 0.62) {
  if (!(decaySeconds > 0) || !(meanTapSeconds > 0)) return 0;
  const gain = Math.pow(10, (-3 * meanTapSeconds) / decaySeconds);
  return clamp(gain, 0, maxFeedback);
}

const REVERB_TAPS_L = [0.037, 0.071, 0.113, 0.167];
const REVERB_TAPS_R = [0.043, 0.079, 0.131, 0.181];
const MEAN_TAP = REVERB_TAPS_L.reduce((a, b) => a + b, 0) / REVERB_TAPS_L.length;

export class VocalDSP {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.enabled = true;

    // --- Kullanici tarafindan ayarlanabilir ---
    this.inputGain = 1.0;        // mikrofon giris seviyesi
    this.reverbMix = 0.14;       // %14 - vokal onde kalir
    this.echoMix = 0.06;         // %6
    this.outputGain = 0.85;

    // --- Sabit studyo ayarlari (dinleyerek secildi) ---
    this.gateThresholdDb = -52;  // yalnizca sessizlik tabanini keser
    this.gateRangeDb = -16;      // tam susturma degil: dogal nefes kalir
    this.gateAttack = timeConstant(0.004, sampleRate);
    this.gateRelease = timeConstant(0.120, sampleRate);
    this.gateHoldSamples = Math.round(0.080 * sampleRate);
    this.gateHoldCounter = 0;
    this.gateEnvelope = 0;
    this.gateGainDb = this.gateRangeDb;

    this.compThresholdDb = -18;
    this.compRatio = 3;
    this.compKneeDb = 6;
    this.compAttack = timeConstant(0.015, sampleRate);
    this.compRelease = timeConstant(0.140, sampleRate);
    this.compEnvelopeDb = -90;
    // Kismi makyaj: tam telafi sesi fazla one cikariyor.
    this.compMakeup = dbToLinear(-this.compThresholdDb * (1 - 1 / this.compRatio) * 0.55);

    this.warmth = 0.16;

    this.limiterThresholdDb = -1;
    this.limiterAttack = timeConstant(0.0008, sampleRate);
    this.limiterRelease = timeConstant(0.060, sampleRate);
    this.limiterEnvelopeL = 0;
    this.limiterEnvelopeR = 0;

    // 4. dereceden Butterworth (24 dB/oktav), iki 2. derece bolum halinde.
    // Tek bolum (12 dB/oktav) 30 Hz'de yalnizca ~17 dB bastiriyordu; dizustu
    // mikrofonlarinda masa/govde gurultusu icin bu yetersiz. Iki bolumun
    // Q degerleri Butterworth kutup aciklarindan gelir.
    this.highpass = new BiquadChain([
      highpassCoefficients(80, sampleRate, 0.5412),
      highpassCoefficients(80, sampleRate, 1.3066),
    ]);
    this.eq = new BiquadChain([
      peakingCoefficients(300, sampleRate, 1.0, -2.5),   // camur / kutu sesi
      peakingCoefficients(3200, sampleRate, 0.9, 3.0),   // netlik / anlasilirlik
      highShelfCoefficients(9000, sampleRate, 1.5),      // hava
    ]);

    this.decaySeconds = 1.5;
    this.reverb = new MultiTapReverb(sampleRate, {
      tapsL: REVERB_TAPS_L,
      gainsL: [0.44, 0.31, 0.22, 0.16],
      tapsR: REVERB_TAPS_R,
      gainsR: [0.42, 0.30, 0.23, 0.15],
      feedbackAmount: feedbackForDecay(1.5, MEAN_TAP),
      echoFeedbackAmount: 0.08,
      smoothingCoeff: 0.77,
      bufferSeconds: 2.2,
      echoTapL: 0.095,          // 95 ms - istenen 70-120 ms araliginin ortasi
      echoTapR: 0.095 * 1.08,   // hafif stereo yayilim
    });

    this.peak = 0;
    this.inputPeak = 0;
  }

  /** Pinch jesti icin korunan eski arayuz: tek bir "efekt miktari". */
  setFxAmount(amount) {
    const a = clamp(amount, 0, 1);
    this.reverbMix = lerp(0.06, 0.20, a);
    this.echoMix = lerp(0.02, 0.09, a);
  }

  setInputGain(value) { this.inputGain = clamp(value, 0, 4); }
  setReverbMix(value) { this.reverbMix = clamp(value, 0, 0.35); }
  setEchoMix(value) { this.echoMix = clamp(value, 0, 0.20); }

  /** Sonme suresi saniye cinsinden (1.2 - 1.8 dogal aralik). */
  setDecaySeconds(seconds) {
    this.decaySeconds = clamp(seconds, 0.4, 3.0);
    this.reverb.feedbackAmount = feedbackForDecay(this.decaySeconds, MEAN_TAP);
  }

  reset() {
    this.highpass.reset();
    this.eq.reset();
    this.gateEnvelope = 0;
    this.gateGainDb = this.gateRangeDb;
    this.gateHoldCounter = 0;
    this.compEnvelopeDb = -90;
    this.limiterEnvelopeL = 0;
    this.limiterEnvelopeR = 0;
  }

  /** @param {Float32Array|Float64Array} mono @returns {[Float32Array, Float32Array]} */
  process(mono) {
    const frames = mono.length;
    if (frames === 0) return [new Float32Array(0), new Float32Array(0)];

    const work = new Float64Array(frames);
    let inputPeak = 0;
    for (let i = 0; i < frames; i++) {
      const sample = mono[i] * this.inputGain;
      work[i] = sample;
      const magnitude = Math.abs(sample);
      if (magnitude > inputPeak) inputPeak = magnitude;
    }
    // Arayuzdeki seviye gostergesi bu degeri kullanir: kompresorden ONCE
    // olculur, boylece kullanici giris kazancini oynattiginda gosterge
    // dogrudan tepki verir. Kompresor sonrasi olculseydi gosterge
    // sikistirma yuzunden neredeyse sabit kalirdi.
    this.inputPeak = inputPeak;

    // 1) Yuksek geciren.
    this.highpass.processInPlace(work);

    // 2) Gurultu kapisi - orneklem basina zarf, ms zaman sabitleri, kismi
    //    kapanma (tam susturma nefesleri kesip yapay duyuluyordu).
    const gateThresholdLinear = dbToLinear(this.gateThresholdDb);
    for (let i = 0; i < frames; i++) {
      const rectified = Math.abs(work[i]);
      const coefficient = rectified > this.gateEnvelope ? this.gateAttack : this.gateRelease;
      this.gateEnvelope = rectified + coefficient * (this.gateEnvelope - rectified);

      if (this.gateEnvelope >= gateThresholdLinear) this.gateHoldCounter = this.gateHoldSamples;
      else if (this.gateHoldCounter > 0) this.gateHoldCounter--;

      const targetDb = this.gateHoldCounter > 0 ? 0 : this.gateRangeDb;
      const coefficientGain = targetDb > this.gateGainDb ? this.gateAttack : this.gateRelease;
      this.gateGainDb = targetDb + coefficientGain * (this.gateGainDb - targetDb);
      work[i] *= dbToLinear(this.gateGainDb);
    }

    // 3) EQ.
    this.eq.processInPlace(work);

    // 4) Kompresor - yumusak dizli, orneklem basina.
    const kneeHalf = this.compKneeDb / 2;
    const slope = 1 - 1 / this.compRatio;
    for (let i = 0; i < frames; i++) {
      const levelDb = linearToDb(work[i]);
      const coefficient = levelDb > this.compEnvelopeDb ? this.compAttack : this.compRelease;
      this.compEnvelopeDb = levelDb + coefficient * (this.compEnvelopeDb - levelDb);

      const over = this.compEnvelopeDb - this.compThresholdDb;
      let reductionDb = 0;
      if (over >= kneeHalf) {
        reductionDb = -slope * over;
      } else if (over > -kneeHalf) {
        // Diz bolgesinde ikinci dereceden gecis.
        const knee = over + kneeHalf;
        reductionDb = (-slope * knee * knee) / (2 * this.compKneeDb);
      }
      work[i] *= dbToLinear(reductionDb) * this.compMakeup;
    }

    // 5) Hafif doygunluk.
    const drive = 1 + this.warmth * 0.5;
    const normalise = 1 / Math.tanh(drive);
    for (let i = 0; i < frames; i++) work[i] = Math.tanh(work[i] * drive) * normalise;

    // Tepe olcumu (arayuzdeki seviye gostergesi ve clipping uyarisi icin,
    // limitleyiciden ONCE - kullanici gercekten fazla surdugunu gormeli).
    let peak = 0;
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(work[i]));
    this.peak = peak;

    const left = new Float32Array(frames);
    const right = new Float32Array(frames);

    if (!this.enabled) {
      for (let i = 0; i < frames; i++) {
        const v = work[i] * this.outputGain;
        left[i] = v;
        right[i] = v;
      }
      this._limit(left, right);
      return [left, right];
    }

    // 6) Reverb + kisa stereo delay.
    const { wetL, wetR, echoL, echoR } = this.reverb.process(work, work);
    for (let i = 0; i < frames; i++) {
      left[i] = (work[i] + wetL[i] * this.reverbMix + echoL[i] * this.echoMix) * this.outputGain;
      right[i] = (work[i] + wetR[i] * this.reverbMix + echoR[i] * this.echoMix) * this.outputGain;
    }

    // 7) Tepe limitleyici.
    this._limit(left, right);
    return [left, right];
  }

  /** Ani tepelerde bozulmayi onler; normal seviyede sinyale dokunmaz. */
  _limit(left, right) {
    const ceiling = dbToLinear(this.limiterThresholdDb);
    for (let i = 0; i < left.length; i++) {
      for (const channel of [0, 1]) {
        const buffer = channel === 0 ? left : right;
        const rectified = Math.abs(buffer[i]);
        const key = channel === 0 ? "limiterEnvelopeL" : "limiterEnvelopeR";
        const coefficient = rectified > this[key] ? this.limiterAttack : this.limiterRelease;
        this[key] = rectified + coefficient * (this[key] - rectified);
        const gain = this[key] > ceiling ? ceiling / this[key] : 1;
        buffer[i] = clamp(buffer[i] * gain, -0.999, 0.999);
      }
    }
  }
}
