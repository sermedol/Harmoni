// Akor sembolu cozumleyici ve akor dizisi (progression) modeli.
//
// Amac: kullanicinin elle yazdigi "Am · F · C · G" gibi bir diziyi calinabilir
// notalara cevirmek. Jest ve otomatik tonalite analizinden BAGIMSIZDIR:
// manuel mod bu modulu kullanir, digerleri kendi yollarini surdurur.
//
// Kapsam bilincli olarak dar tutuldu: uclu, yedili, sus, add9, 6 ve bas
// notasi (slash) desteklenir. Desteklenmeyen bir sembol sessizce yanlis
// calmaz - null doner ve arayuz kullaniciyi uyarir.

const PITCH_CLASS = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  // Turkce nota adlari da kabul edilir.
  DO: 0, RE: 2, MI: 4, FA: 5, SOL: 7, LA: 9, SI: 11,
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Akor kalitesi -> koke gore yari ses araliklari.
const QUALITIES = [
  // Uzun ekler ONCE denenir: "maj7" once, "m" sonra.
  { match: ["maj7", "M7", "Δ7", "Δ"], intervals: [0, 4, 7, 11], label: "maj7" },
  { match: ["m7b5", "ø", "min7b5"], intervals: [0, 3, 6, 10], label: "m7b5" },
  { match: ["dim7", "°7"], intervals: [0, 3, 6, 9], label: "dim7" },
  { match: ["dim", "°", "mb5"], intervals: [0, 3, 6], label: "dim" },
  { match: ["aug", "+", "#5"], intervals: [0, 4, 8], label: "aug" },
  { match: ["sus2"], intervals: [0, 2, 7], label: "sus2" },
  { match: ["sus4", "sus"], intervals: [0, 5, 7], label: "sus4" },
  { match: ["add9", "add2"], intervals: [0, 4, 7, 14], label: "add9" },
  { match: ["m9", "min9"], intervals: [0, 3, 7, 10, 14], label: "m9" },
  { match: ["m7", "min7", "-7"], intervals: [0, 3, 7, 10], label: "m7" },
  { match: ["m6", "min6"], intervals: [0, 3, 7, 9], label: "m6" },
  { match: ["m", "min", "-"], intervals: [0, 3, 7], label: "m" },
  { match: ["9"], intervals: [0, 4, 7, 10, 14], label: "9" },
  { match: ["7"], intervals: [0, 4, 7, 10], label: "7" },
  { match: ["6"], intervals: [0, 4, 7, 9], label: "6" },
  { match: ["5"], intervals: [0, 7], label: "5" },        // guc akoru
  // Majör uclu. "M" ve "maj" da kabul edilir; "M7" yukarida daha once
  // eslestigi icin buraya dusmez.
  { match: ["", "M", "maj"], intervals: [0, 4, 7], label: "" },
];

/**
 * Tek bir akor sembolunu cozumler.
 * @param {string} symbol "Am", "F#m7", "Csus4", "G/B", "Do", "Lam"
 * @param {number} [octave] kok notanin oktavi (varsayilan 4 -> C4 = 60)
 * @returns {{root:number, bass:number, intervals:number[], notes:number[],
 *            quality:string, name:string, symbol:string}|null}
 */
export function parseChord(symbol, octave = 4) {
  if (typeof symbol !== "string") return null;
  const text = symbol.trim();
  if (!text) return null;

  // Slash akoru: "G/B" -> akor G, bas B.
  const [chordPart, bassPart] = text.split("/");

  const rootInfo = readRoot(chordPart);
  if (!rootInfo) return null;
  const { pitchClass, rest } = rootInfo;

  // Kalite eslesmesi.
  //
  // BUYUK/KUCUK HARF ANLAMLIDIR: "M7" majör yedili, "m7" minör yedilidir.
  // Kucuk harfe cevirip karsilastirmak bu ikisini ayni yapar ve akoru
  // tamamen yanlis calar. Bu yuzden once TAM (harf duyarli) eslesme
  // denenir; harf duyarsiz eslesme yalnizca uzunlugu 3+ olan, ikircikli
  // olmayan eklere (maj7, min7, sus4, dim...) uygulanir.
  let quality = null;
  for (const candidate of QUALITIES) {
    if (candidate.match.includes(rest)) { quality = candidate; break; }
  }
  if (!quality) {
    const lowered = rest.toLowerCase();
    for (const candidate of QUALITIES) {
      const hit = candidate.match.find(
        (token) => token.length >= 3 && token.toLowerCase() === lowered
      );
      if (hit) { quality = candidate; break; }
    }
  }
  if (!quality) return null;                 // taninmayan sembol

  const root = 12 * (octave + 1) + pitchClass;
  let bass = root - 12;
  if (bassPart) {
    const bassInfo = readRoot(bassPart);
    if (!bassInfo || bassInfo.rest !== "") return null;
    bass = 12 * octave + bassInfo.pitchClass;
  }

  return {
    root,
    bass,
    intervals: [...quality.intervals],
    notes: quality.intervals.map((step) => root + step),
    quality: quality.label,
    name: `${NOTE_NAMES[pitchClass]}${quality.label}${bassPart ? `/${bassPart.trim()}` : ""}`,
    symbol: text,
  };
}

/** Kok nota adini okur; geri kalani kalite eki olarak dondurur. */
function readRoot(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Once uc harfli Turkce adlar (SOL), sonra iki harfli (DO/RE/MI/FA/LA/SI),
  // en son tek harfli Ingilizce adlar. Uzun eslesme once denenir ki
  // "Sol" bir "S" olarak okunmasin.
  for (const length of [3, 2, 1]) {
    if (trimmed.length < length) continue;
    const head = trimmed.slice(0, length).toUpperCase();
    if (!(head in PITCH_CLASS)) continue;
    let pitchClass = PITCH_CLASS[head];
    let rest = trimmed.slice(length);
    // Diyez / bemol.
    while (rest[0] === "#" || rest[0] === "b" || rest[0] === "♯" || rest[0] === "♭") {
      // "b" harfi hem bemol hem de "Bb" gibi nota adi olabilir; burada
      // kok zaten okundugu icin bu konumdaki b daima bemoldur.
      pitchClass += (rest[0] === "#" || rest[0] === "♯") ? 1 : -1;
      rest = rest.slice(1);
    }
    return { pitchClass: ((pitchClass % 12) + 12) % 12, rest };
  }
  return null;
}

/**
 * Serbest metinden akor dizisi olusturur.
 * Ayirici olarak bosluk, virgul, tire, nokta ve orta nokta kabul edilir.
 * @returns {{chords:Array, invalid:string[]}}
 */
export function parseProgression(text) {
  const tokens = String(text || "")
    .split(/[\s,·|]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const chords = [];
  const invalid = [];
  for (const token of tokens) {
    const chord = parseChord(token);
    if (chord) chords.push(chord);
    else invalid.push(token);
  }
  return { chords, invalid };
}

/**
 * Akor dizisi calaci. Her cagrida siradaki akoru dondurur; dizi bitince
 * basa doner. Zamanlama disaridan gelir (olcu sinirinda cagrilir), boylece
 * ritmik kararlar tek yerde kalir.
 */
export function createProgressionPlayer() {
  let chords = [];
  let index = 0;
  return {
    set(list) {
      chords = Array.isArray(list) ? [...list] : [];
      index = 0;
    },
    get length() { return chords.length; },
    get currentIndex() { return chords.length ? index % chords.length : -1; },
    /** Siradaki akoru dondurur ve imleci ilerletir. */
    next() {
      if (!chords.length) return null;
      const chord = chords[index % chords.length];
      index = (index + 1) % chords.length;
      return chord;
    },
    /** Imleci ilerletmeden mevcut akoru dondurur. */
    peek() {
      if (!chords.length) return null;
      return chords[index % chords.length];
    },
    reset() { index = 0; },
  };
}
