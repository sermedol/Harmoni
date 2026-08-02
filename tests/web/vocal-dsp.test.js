import test from "node:test";
import assert from "node:assert/strict";
import { VocalDSP, feedbackForDecay, timeConstant } from "../../docs/js/audio/worklet/vocal-dsp.js";
import { BiquadChain, highpassCoefficients, peakingCoefficients, highShelfCoefficients, magnitudeDb } from "../../docs/js/audio/worklet/biquad.js";

const SAMPLE_RATE = 48000;
const BLOCK = 128;

const toDb = (linear) => 20 * Math.log10(Math.abs(linear) + 1e-12);
const fromDb = (db) => Math.pow(10, db / 20);

/** DSP'yi verilen genlikte sinusle surer, son bloklarin tepe degerini dondurur. */
function drive(dsp, amplitude, { frequency = 220, seconds = 1.2 } = {}) {
  const blocks = Math.round((seconds * SAMPLE_RATE) / BLOCK);
  const settleAfter = Math.round(blocks * 0.75);
  let phase = 0;
  const step = (2 * Math.PI * frequency) / SAMPLE_RATE;
  let peak = 0;
  for (let block = 0; block < blocks; block++) {
    const input = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) { input[i] = Math.sin(phase) * amplitude; phase += step; }
    const [left] = dsp.process(input);
    if (block >= settleAfter) for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(left[i]));
  }
  return peak;
}

/** Yalnizca kompresoru olcebilmek icin diger asamalari devre disi birakir. */
function compressorOnly() {
  const dsp = new VocalDSP(SAMPLE_RATE);
  dsp.eq = new BiquadChain([]);          // EQ kazanci olcumu kirletmesin
  dsp.warmth = 0;                        // doygunluk dogrusal olmayan katki yapmasin
  dsp.gateThresholdDb = -140;            // kapi hep acik
  dsp.enabled = false;                   // reverb/echo yok
  dsp.outputGain = 1;
  dsp.limiterThresholdDb = 60;           // limitleyici devrede degil
  return dsp;
}

test("EQ bantlari hedeflenen frekanslari etkiler, komsularini birakir", () => {
  const mud = peakingCoefficients(300, SAMPLE_RATE, 1.0, -2.5);
  assert.ok(magnitudeDb(mud, 300, SAMPLE_RATE) < -2, "300 Hz kesilmeli");
  assert.ok(Math.abs(magnitudeDb(mud, 3200, SAMPLE_RATE)) < 0.5, "3.2 kHz etkilenmemeli");

  const presence = peakingCoefficients(3200, SAMPLE_RATE, 0.9, 3);
  assert.ok(magnitudeDb(presence, 3200, SAMPLE_RATE) > 2.5, "3.2 kHz kaldirilmali");
  assert.ok(Math.abs(magnitudeDb(presence, 200, SAMPLE_RATE)) < 0.5, "200 Hz etkilenmemeli");

  // Eski "presence" ilk-fark vurgusuydu: frekansla surekli yukselirdi, yani
  // 10 kHz'i 3 kHz'den DAHA COK kaldirip tislama uretirdi. Tepe filtresinde
  // 10 kHz katkisi 3.2 kHz'den kucuk olmali.
  assert.ok(
    magnitudeDb(presence, 10000, SAMPLE_RATE) < magnitudeDb(presence, 3200, SAMPLE_RATE),
    "netlik bandi tislamayi one cikarmamali"
  );

  const air = highShelfCoefficients(9000, SAMPLE_RATE, 1.5);
  assert.ok(magnitudeDb(air, 14000, SAMPLE_RATE) > 1, "hava rafi ust bolgeyi acmali");
  assert.ok(Math.abs(magnitudeDb(air, 500, SAMPLE_RATE)) < 0.4, "hava rafi govdeyi bozmamali");
});

test("80 Hz yuksek geciren dip gurultusunu bastirir, vokal govdesini birakir", () => {
  // 4. dereceden Butterworth: iki bolumun toplam tepkisi.
  const sections = [
    highpassCoefficients(80, SAMPLE_RATE, 0.5412),
    highpassCoefficients(80, SAMPLE_RATE, 1.3066),
  ];
  const responseAt = (frequency) => sections.reduce((sum, s) => sum + magnitudeDb(s, frequency, SAMPLE_RATE), 0);

  assert.ok(responseAt(30) < -25, `30 Hz ciddi bastirilmali, olculen ${responseAt(30).toFixed(1)} dB`);
  assert.ok(responseAt(50) < -12, `50 Hz masa gurultusu bastirilmali, olculen ${responseAt(50).toFixed(1)} dB`);
  assert.ok(Math.abs(responseAt(80) + 3) < 1.5, `80 Hz kesim -3 dB olmali, olculen ${responseAt(80).toFixed(1)} dB`);
  assert.ok(responseAt(200) > -1.5, `200 Hz vokal govdesi korunmali, olculen ${responseAt(200).toFixed(1)} dB`);
  assert.ok(responseAt(500) > -0.4, "500 Hz dokunulmamis olmali");
});

test("kompresor esik ustunde yaklasik 3:1 oraninda calisir", () => {
  // Dizin (knee) etkisinden kacinmak icin iki seviye de esigin belirgin
  // ustunde secildi: -12 ve 0 dBFS, aralarinda tam 12 dB var.
  const quietPeak = toDb(drive(compressorOnly(), fromDb(-12)));
  const loudPeak = toDb(drive(compressorOnly(), fromDb(0)));
  const outputDelta = loudPeak - quietPeak;
  const ratio = 12 / outputDelta;
  assert.ok(ratio > 2.4 && ratio < 3.8, `oran 3:1 civarinda olmali, olculen ${ratio.toFixed(2)}:1`);
});

test("kompresor esigin altindaki sinyali sikistirmaz", () => {
  const a = toDb(drive(compressorOnly(), fromDb(-42)));
  const b = toDb(drive(compressorOnly(), fromDb(-36)));
  // 6 dB giris farki cikista da yaklasik 6 dB kalmali (oran ~1:1).
  assert.ok(Math.abs((b - a) - 6) < 1.2, `esik altinda sikistirma olmamali, fark ${(b - a).toFixed(2)} dB`);
});

test("gurultu kapisi sessizlik tabanini kisar ama vokali gecirir", () => {
  const gated = compressorOnly();
  gated.gateThresholdDb = -52;
  const quiet = toDb(drive(gated, fromDb(-72), { seconds: 1.5 }));

  const open = compressorOnly();
  open.gateThresholdDb = -52;
  const loud = toDb(drive(open, fromDb(-20), { seconds: 1.5 }));

  // Esik altindaki sinyal kapinin menzili kadar (~16 dB) daha da kisilmali.
  assert.ok(quiet < -72, `sessizlik tabani bastirilmali, olculen ${quiet.toFixed(1)} dBFS`);
  // Vokal seviyesindeki sinyal gecmeli (kapi yuzunden kaybolmamali).
  assert.ok(loud > -30, `vokal kapiya takilmamali, olculen ${loud.toFixed(1)} dBFS`);
});

test("limitleyici tavani asmaya izin vermez", () => {
  const dsp = new VocalDSP(SAMPLE_RATE);
  const peak = drive(dsp, 4.0, { seconds: 1.5 });   // kasitli olarak cok yuksek surus
  const ceiling = fromDb(dsp.limiterThresholdDb);
  assert.ok(peak <= ceiling * 1.12, `tepe tavani asmamali: ${toDb(peak).toFixed(2)} dBFS`);
  assert.ok(peak <= 0.999, "cikis her zaman tam olcek icinde kalmali");
});

test("normal seviyede limitleyici sinyali ezmez", () => {
  const dsp = new VocalDSP(SAMPLE_RATE);
  dsp.enabled = false;
  const peak = toDb(drive(dsp, fromDb(-24)));
  assert.ok(peak > -40, `sakin sinyal limitleyiciden gecmeli, olculen ${peak.toFixed(1)} dBFS`);
});

test("reverb sonme suresi RT60'tan hesaplanir ve kararli kalir", () => {
  const meanTap = 0.097;
  const short = feedbackForDecay(1.2, meanTap);
  const long = feedbackForDecay(1.8, meanTap);
  assert.ok(long > short, "uzun sonme daha yuksek geri besleme gerektirir");
  assert.ok(long < 1, "geri besleme 1'i asmamali - aksi halde reverb patlar");

  const dsp = new VocalDSP(SAMPLE_RATE);
  dsp.setDecaySeconds(1.8);
  assert.ok(dsp.reverb.feedbackAmount < 0.7, "kararlilik ust siniri uygulanmali");
  dsp.setDecaySeconds(99);
  assert.ok(dsp.reverb.feedbackAmount <= 0.62, "asiri deger kelepcelenmeli");
});

test("efekt miktari vokali one birakan araliklarda kalir", () => {
  const dsp = new VocalDSP(SAMPLE_RATE);
  dsp.setFxAmount(1);
  // Talep edilen tasarim: reverb %10-18, echo %4-8 civari; ust sinirda bile
  // vokal onde kalmali, banyo etkisi olusmamali.
  assert.ok(dsp.reverbMix <= 0.22, `reverb orani cok yuksek: ${dsp.reverbMix}`);
  assert.ok(dsp.echoMix <= 0.10, `echo orani cok yuksek: ${dsp.echoMix}`);
  dsp.setFxAmount(0);
  assert.ok(dsp.reverbMix >= 0.03, "en dusuk ayarda bile bir miktar derinlik kalmali");
});

test("zaman sabiti orneklem hizindan bagimsiz ayni sureyi verir", () => {
  // 15 ms atak 48 kHz'de de 44.1 kHz'de de 15 ms olmali.
  const at48 = timeConstant(0.015, 48000);
  const at44 = timeConstant(0.015, 44100);
  const settle = (coefficient, sampleRate) => {
    let value = 1;
    let samples = 0;
    while (value > 1 / Math.E && samples < sampleRate) { value *= coefficient; samples++; }
    return samples / sampleRate;
  };
  assert.ok(Math.abs(settle(at48, 48000) - settle(at44, 44100)) < 0.002);
});
