// harmoni.py SynthEngine._apply_orchestra_reverb ve VocalDSP.process'in
// reverb adimlarinin ORTAK cekirdegi: cok-vuruşlu (multi-tap) gecikmeli
// geri-besleme (feedback) reverb'i. Python'da bu desen iki ayri yerde
// (vokal ve orkestra) kasitli olarak tekrarlanir (ayni mimari, farkli
// parametreler); burada tek, parametrize edilebilir bir modul olarak
// paylasiliyor - hem Milestone 4'teki orkestra reverb'i hem de Milestone
// 5'teki vokal reverb'i bu sinifi kullanacak.
import { onePoleLowpass } from "../../constants/music-utils.js";

function clampVal(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class MultiTapReverb {
  /**
   * @param {number} sampleRate
   * @param {object} opts
   * @param {number[]} opts.tapsL - saniye cinsinden gecikme sureleri (sol kanal)
   * @param {number[]} opts.gainsL
   * @param {number[]} [opts.tapsR] - verilmezse tapsL kullanilir (simetrik, orkestra reverb'i gibi)
   * @param {number[]} [opts.gainsR]
   * @param {number} opts.feedbackAmount - wet sinyalin ne kadarinin geri beslenecegi
   * @param {number} opts.smoothingCoeff - geri besleme yolundaki tek-kutuplu alcak-gecirgen katsayisi
   * @param {number} opts.bufferSeconds - dairesel tampon uzunlugu (saniye)
   * @param {number} [opts.echoTapL] - VocalDSP'nin ayri echo vuruşu (saniye, opsiyonel)
   * @param {number} [opts.echoTapR]
   * @param {number} [opts.echoFeedbackAmount] - echo'nun geri besleme karisimina katkisi (varsayilan 0 - orkestra reverb'inde kullanilmaz)
   */
  constructor(sampleRate, opts) {
    this.sampleRate = sampleRate;
    this.tapsL = opts.tapsL.map((t) => Math.round(t * sampleRate));
    this.gainsL = opts.gainsL;
    this.tapsR = (opts.tapsR || opts.tapsL).map((t) => Math.round(t * sampleRate));
    this.gainsR = opts.gainsR || opts.gainsL;
    this.feedbackAmount = opts.feedbackAmount;
    this.smoothingCoeff = opts.smoothingCoeff;
    this.size = Math.max(1, Math.round(sampleRate * opts.bufferSeconds));
    this.bufL = new Float64Array(this.size);
    this.bufR = new Float64Array(this.size);
    this.pos = 0;
    this.fbL = 0;
    this.fbR = 0;
    this.echoTapL = opts.echoTapL != null ? Math.round(opts.echoTapL * sampleRate) : null;
    this.echoTapR = opts.echoTapR != null ? Math.round(opts.echoTapR * sampleRate) : null;
    this.echoFeedbackAmount = opts.echoFeedbackAmount || 0;
  }

  /**
   * dryL/dryR: Float64Array giris (kuru sinyal). Donen {wetL, wetR, echoL, echoR}:
   * cagiran taraf kendi wet/dry (ve varsa echo) karisimini (orn. dry + wet*mix
   * + echo*echoMix) kendisi uygular - reverb_mix ve echo_mix VocalDSP'de
   * birbirinden bagimsiz kontrollerdir.
   */
  process(dryL, dryR) {
    const frames = dryL.length;
    const { size, bufL, bufR, tapsL, gainsL, tapsR, gainsR, pos, echoTapL, echoTapR } = this;
    const wetL = new Float64Array(frames);
    const wetR = new Float64Array(frames);
    const echoL = new Float64Array(frames);
    const echoR = new Float64Array(frames);

    for (let i = 0; i < frames; i++) {
      const idx = (pos + i) % size;
      let wl = 0;
      for (let k = 0; k < tapsL.length; k++) {
        const tapIdx = ((idx - tapsL[k]) % size + size) % size;
        wl += bufL[tapIdx] * gainsL[k];
      }
      let wr = 0;
      for (let k = 0; k < tapsR.length; k++) {
        const tapIdx = ((idx - tapsR[k]) % size + size) % size;
        wr += bufR[tapIdx] * gainsR[k];
      }
      wetL[i] = wl;
      wetR[i] = wr;
      if (echoTapL != null) echoL[i] = bufL[((idx - echoTapL) % size + size) % size];
      if (echoTapR != null) echoR[i] = bufR[((idx - echoTapR) % size + size) % size];
    }

    const feedbackL = new Float64Array(frames);
    const feedbackR = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      feedbackL[i] = this.feedbackAmount * wetL[i] + this.echoFeedbackAmount * echoL[i];
      feedbackR[i] = this.feedbackAmount * wetR[i] + this.echoFeedbackAmount * echoR[i];
    }
    const [smoothL, fbL] = onePoleLowpass(feedbackL, this.smoothingCoeff, this.fbL);
    const [smoothR, fbR] = onePoleLowpass(feedbackR, this.smoothingCoeff, this.fbR);
    this.fbL = fbL;
    this.fbR = fbR;

    for (let i = 0; i < frames; i++) {
      const idx = (pos + i) % size;
      bufL[idx] = clampVal(dryL[i] + smoothR[i], -1.2, 1.2);
      bufR[idx] = clampVal(dryR[i] + smoothL[i], -1.2, 1.2);
    }
    this.pos = (pos + frames) % size;

    return { wetL, wetR, echoL, echoR };
  }
}
