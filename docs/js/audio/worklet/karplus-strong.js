// harmoni.py SynthEngine._karplus_strong_pluck - birebir port. Baglama ve
// gitar sesleri bu dairesel gecikme hatti (delay line) yinelemesini paylasir.
import { mulberry32 } from "../../constants/music-utils.js";

/**
 * voice uzerinde ksBuffer/ksPos alanlarini kullanir (Python'daki
 * Voice.ks_buffer/ks_pos ile ayni amac). Ilk cagrida gecikme hattini
 * voice.seed ile turetilen bir gurultu patlamasiyla doldurur.
 */
export function karplusStrongPluck(voice, frames, sampleRate, decayLow, decayHigh, burstTone = 0.5) {
  if (!voice.ksBuffer) {
    const nDelay = Math.max(4, Math.round(sampleRate / Math.max(voice._frequency, 20.0)));
    const rand = mulberry32(voice.seed >>> 0);
    const burst = new Float64Array(nDelay);
    for (let i = 0; i < nDelay; i++) burst[i] = rand() * 2 - 1;
    // burst = burstTone*burst + (1-burstTone)*shift(burst,1)
    const shaped = new Float64Array(nDelay);
    for (let i = 0; i < nDelay; i++) {
      const prev = i === 0 ? 0 : burst[i - 1];
      shaped[i] = burstTone * burst[i] + (1 - burstTone) * prev;
    }
    voice.ksBuffer = shaped;
    voice.ksPos = 0;
  }
  const buffer = voice.ksBuffer;
  const nDelay = buffer.length;
  const decay = voice.midiNote < 60 ? decayLow : decayHigh;
  const out = new Float64Array(frames);
  let pos = voice.ksPos;
  for (let i = 0; i < frames; i++) {
    const current = buffer[pos];
    const next = buffer[(pos + 1) % nDelay];
    out[i] = current;
    buffer[pos] = decay * 0.5 * (current + next);
    pos = (pos + 1) % nDelay;
  }
  voice.ksPos = pos;
  return out;
}
