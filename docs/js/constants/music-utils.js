// harmoni.py: NOTE_NAMES, midi_to_name, frequency_to_midi, midi_to_frequency,
// clamp, lerp, one_pole_lowpass - birebir port.

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_NAMES_TR = ["DO", "DO#", "RE", "RE#", "MI", "FA", "FA#", "SOL", "SOL#", "LA", "LA#", "SI"];

export function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

export function midiToName(midiNote, turkish = false) {
  const names = turkish ? NOTE_NAMES_TR : NOTE_NAMES;
  const octave = Math.floor(midiNote / 12) - 1;
  const idx = ((Math.round(midiNote) % 12) + 12) % 12;
  return `${names[idx]}${octave}`;
}

export function frequencyToMidi(frequency) {
  return 69.0 + 12.0 * Math.log2(Math.max(frequency, 1e-6) / 440.0);
}

export function midiToFrequency(midiNote) {
  return 440.0 * Math.pow(2.0, (midiNote - 69.0) / 12.0);
}

// y[n] = (1-coeff)*x[n] + coeff*y[n-1], tek kutuplu alcak-gecirgen filtre.
// state: onceki cagridan kalan y[-1]. Donen deger: [Float32Array, yeniState].
// Sessizlik donemlerinde (orn. reverb kuyrugu sifira yaklasirken) durum
// degeri "denormal" (asiri kucuk) sayilara duserse bazi CPU'larda islem
// suresi ciddi sekilde uzayip gercek-zamanli ses kesintisine (cizirti) yol
// acabilir - esik altina inince sifira "flush" edilir (Python/numpy'da bu
// sorun yoktu, JS/V8 icin ek bir guvenlik onlemi).
const DENORMAL_FLOOR = 1e-15;

export function onePoleLowpass(x, coeff, state) {
  const y = new Float32Array(x.length);
  let acc = state;
  for (let i = 0; i < x.length; i++) {
    acc = (1.0 - coeff) * x[i] + coeff * acc;
    if (acc < DENORMAL_FLOOR && acc > -DENORMAL_FLOOR) acc = 0;
    y[i] = acc;
  }
  return [y, acc];
}

// mulberry32 - Voice basina numpy default_rng(seed) yerine deterministik,
// hafif bir PRNG (ayni "tekrarlanabilir ama cesitli" ozelligi saglar).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
