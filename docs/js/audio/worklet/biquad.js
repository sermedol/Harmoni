// Ikinci dereceden (biquad) filtre - RBJ Audio EQ Cookbook katsayilari.
//
// Neden gerekli: VocalDSP'nin onceki "presence" adimi bir ilk-fark
// (x[n] - x[n-1]) vurgusuydu. Bu, frekansa gore 6 dB/oktav surekli yukselen
// bir egim uretir; yani netlik icin gereken 3-5 kHz bolgesini kaldirirken
// ayni anda tislama (8-12 kHz) ve mikrofon gurultusunu de kaldirir. Gercek
// bir tepe (peaking) filtresi yalnizca hedeflenen bandi etkiler.
//
// Uygulama Transposed Direct Form II: sabit katsayili filtrelerde Direct
// Form I'e gore daha iyi sayisal davranir ve durum olarak yalnizca iki
// degisken tutar.

function normalise(b0, b1, b2, a0, a1, a2) {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Yuksek geciren (dip gurultusu, mikrofon govde sesi, patlayici p/b sesleri). */
export function highpassCoefficients(frequency, sampleRate, q = 0.707) {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  return normalise((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

/** Tepe (peaking) - belirli bir bandi kaldirir veya keser. */
export function peakingCoefficients(frequency, sampleRate, q, gainDb) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  return normalise(1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A);
}

/** Yuksek raf (high shelf) - "hava" / acikligi verir. */
export function highShelfCoefficients(frequency, sampleRate, gainDb, slope = 1) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = (Math.sin(w0) / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
  return normalise(
    A * ((A + 1) + (A - 1) * cos + twoSqrtAAlpha),
    -2 * A * ((A - 1) + (A + 1) * cos),
    A * ((A + 1) + (A - 1) * cos - twoSqrtAAlpha),
    (A + 1) - (A - 1) * cos + twoSqrtAAlpha,
    2 * ((A - 1) - (A + 1) * cos),
    (A + 1) - (A - 1) * cos - twoSqrtAAlpha
  );
}

export class Biquad {
  constructor(coefficients) {
    this.setCoefficients(coefficients);
    this.s1 = 0;
    this.s2 = 0;
  }

  setCoefficients({ b0, b1, b2, a1, a2 }) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2;
  }

  reset() { this.s1 = 0; this.s2 = 0; }

  processSample(x) {
    const y = this.b0 * x + this.s1;
    this.s1 = this.b1 * x - this.a1 * y + this.s2;
    this.s2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /** Diziyi yerinde isler. */
  processInPlace(buffer) {
    for (let i = 0; i < buffer.length; i++) buffer[i] = this.processSample(buffer[i]);
    return buffer;
  }
}

/** Seri bagli biquad zinciri (EQ bolumu). */
export class BiquadChain {
  constructor(stages = []) {
    this.stages = stages.map((coefficients) => new Biquad(coefficients));
  }

  reset() { for (const stage of this.stages) stage.reset(); }

  processInPlace(buffer) {
    for (const stage of this.stages) stage.processInPlace(buffer);
    return buffer;
  }
}

/**
 * Filtrenin belirli bir frekanstaki kazancini dB olarak dondurur.
 * Testlerin EQ'nun gercekten dogru bandi etkiledigini dogrulamasi icin.
 */
export function magnitudeDb({ b0, b1, b2, a1, a2 }, frequency, sampleRate) {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const cos1 = Math.cos(w), sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
  const numeratorReal = b0 + b1 * cos1 + b2 * cos2;
  const numeratorImaginary = -(b1 * sin1 + b2 * sin2);
  const denominatorReal = 1 + a1 * cos1 + a2 * cos2;
  const denominatorImaginary = -(a1 * sin1 + a2 * sin2);
  const numerator = Math.hypot(numeratorReal, numeratorImaginary);
  const denominator = Math.hypot(denominatorReal, denominatorImaginary) || 1e-12;
  return 20 * Math.log10(numerator / denominator + 1e-12);
}
