// Secilebilir tonalite sistemleri. harmoni.py'de bunlar iki ayri kontrole
// bolunmustu (T tusu Bati<->Makam, D tusu dizi rengi, makam ise otomatik
// tespit ediliyordu); web surumunde hepsi TEK bir listede acikca secilebilir
// - kullanicinin "sadece bati ve makam degil bircok secenek olmali" istegi.
import { MAKAM_SCALES_KOMA, MAKAM_DISPLAY_NAMES_TR, makamScaleDegreesKomas, komasToSemitones } from "./makam.js";

// harmoni.py HarmonyEngine._scale_intervals'in genisletilmis hali. Ilk dordu
// Python'dan birebir; geri kalani dunya muziklerini (flamenko, Balkan, blues,
// Uzak Dogu, Bizans/Arap) kapsamak icin eklendi - kullanicinin "aklina
// gelebilecek tum muzik turleri olmali" istegi.
export const WESTERN_SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  // Hicaz'in 12-TET karsiligi: flamenko, Arap, Fars ve metal'de ortak.
  phrygian_dominant: [0, 1, 4, 5, 7, 8, 10],
  // Bizans / "cift armonik": iki artik ikili barindirir.
  double_harmonic: [0, 1, 4, 5, 7, 8, 11],
  blues: [0, 3, 5, 6, 7, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
};

const WESTERN_LABELS = {
  auto: "Otomatik (Majör/Minör)",
  major: "Majör",
  minor: "Minör",
  dorian: "Dorian — folk / caz",
  mixolydian: "Mixolydian — rock / caz",
  phrygian: "Frigyen — metal / İspanyol",
  lydian: "Lidyen — sinemasal",
  locrian: "Lokriyen — gergin",
  harmonic_minor: "Armonik minör — Balkan",
  melodic_minor: "Melodik minör",
  phrygian_dominant: "Hicaz (Frigyen dominant) — flamenko / Arap",
  double_harmonic: "Çift armonik — Bizans",
  blues: "Blues",
  pentatonic_major: "Pentatonik majör — Uzak Doğu",
  pentatonic_minor: "Pentatonik minör — rock / folk",
};

// Makamlarin gelenekteki karakterini kisaca anlatan ipuclari (HUD/aciklama icin).
const MAKAM_HINTS = {
  RAST: "neseli, kararli",
  HICAZ: "hüzünlü, doğulu",
  USSAK: "sade, içli",
  NIHAVENT: "romantik (minöre yakın)",
  KURDI: "yalın, melankolik",
  BUSELIK: "berrak, minör benzeri",
  CARGAH: "parlak (majöre yakın)",
  HUZZAM: "dokunaklı, yanık",
  KARCIGAR: "oynak, hareketli",
  SEGAH: "içten, tatlı",
  NEVA: "dingin, ağırbaşlı",
  HUSEYNI: "yiğit, halk havası",
};

// Listede gorunecek makam sirasi (en yaygin/taninan olanlar once).
const MAKAM_ORDER = [
  "RAST", "HICAZ", "USSAK", "NIHAVENT", "HUZZAM", "KURDI",
  "SEGAH", "KARCIGAR", "HUSEYNI", "NEVA", "BUSELIK", "CARGAH",
];

/** Arayuzdeki gruplu <select> icin secenek agaci. */
export function buildTonalOptionGroups() {
  return [
    {
      label: "Batı (Western)",
      options: Object.keys(WESTERN_LABELS).map((mode) => ({
        value: `western:${mode}`,
        label: WESTERN_LABELS[mode],
      })),
    },
    {
      label: "Türk Makamları",
      options: MAKAM_ORDER.filter((k) => k in MAKAM_SCALES_KOMA).map((key) => ({
        value: `makam:${key}`,
        label: `${MAKAM_DISPLAY_NAMES_TR[key]} — ${MAKAM_HINTS[key] || ""}`.trim(),
      })),
    },
  ];
}

/**
 * Bir secim degerini ("western:dorian" / "makam:HICAZ") ses motorunun
 * anlayacagi duruma cevirir.
 *
 * @param {string} value
 * @param {number} tonicMidi - dizinin/akorun kurulacagi kok nota (varsayilan C4)
 * @returns {{tonalSystem:string, mode:string|null, makamName:string|null,
 *            chordNotes:number[], makamDegrees:number[], displayName:string}}
 */
export function resolveTonalSelection(value, tonicMidi = 60) {
  const [system, key] = String(value).split(":");

  if (system === "makam" && key in MAKAM_SCALES_KOMA) {
    // Perdeler 53 komadan yari-seslere cevrilir (mikrotonal - 12-TET'e
    // yuvarlanmaz; SynthEngine kesirli midi notasini dogrudan calabilir).
    const degrees = makamScaleDegreesKomas(key).map(
      (koma) => tonicMidi + komasToSemitones(koma)
    );
    return {
      tonalSystem: "makam",
      mode: null,
      makamName: key,
      makamDegrees: degrees,
      // Makam modunda eslik blok akor kullanmaz (dron + melodik cevap), ama
      // motorun bir yedegi olmasi icin durak+guclu ucluyu de veriyoruz.
      chordNotes: [degrees[0], degrees[4], degrees[0] + 12],
      displayName: MAKAM_DISPLAY_NAMES_TR[key],
    };
  }

  // Bati: "auto" secilirse motor kendi majör/minör tespitini surdurur;
  // burada baslangic akoru olarak majör ucluyu veriyoruz.
  const mode = key && key !== "auto" && key in WESTERN_SCALE_INTERVALS ? key : null;
  const intervals = WESTERN_SCALE_INTERVALS[mode || "major"];
  const chordNotes = [tonicMidi, tonicMidi + intervals[2], tonicMidi + intervals[4]];
  return {
    tonalSystem: "western",
    mode,
    makamName: null,
    makamDegrees: intervals.map((semi) => tonicMidi + semi),
    chordNotes,
    displayName: WESTERN_LABELS[key] || WESTERN_LABELS.auto,
  };
}
