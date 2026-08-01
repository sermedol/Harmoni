// harmoni.py: Turk makam sistemi (AEU 53 koma) sabitleri - birebir port.
// Kaynak: Arel-Ezgi-Uzdilek (AEU) kurami; sayisal araliklar sonic-pi-net/sonic-pi
// #1705 numarali pull request'ten (kivancguckiran, MIT lisansli) alinmistir.
import { frequencyToMidi } from "./music-utils.js";

export const KOMA_CENTS = 1200.0 / 53.0;

export const MAKAM_SCALES_KOMA = {
  CARGAH: [9, 9, 4, 9, 9, 9, 4],
  BUSELIK: [9, 4, 9, 9, 9, 4, 9],
  KURDI: [4, 9, 9, 9, 4, 9, 9],
  RAST: [9, 8, 5, 9, 9, 8, 5],
  HICAZ: [5, 12, 5, 9, 8, 5, 9],
  USSAK: [8, 5, 9, 9, 4, 9, 9],
  NIHAVENT: [9, 4, 9, 9, 4, 9, 9],
  HUZZAM: [5, 9, 5, 12, 5, 12, 5],
  KARCIGAR: [8, 5, 9, 5, 12, 5, 9],
  SEGAH: [5, 9, 8, 9, 5, 12, 5],
  NEVA: [8, 5, 9, 9, 8, 5, 9],
  HUSEYNI: [8, 5, 9, 9, 8, 5, 9],
};

// ASCII adlar (Python tarafinda OpenCV Hershey fontu Turkce karakterleri
// cizemedigi icin kullanilmisti). Tarayicida gercek Unicode font destegi
// oldugundan, HUD'da MAKAM_DISPLAY_NAMES_TR (dogru yazim) kullanilir.
export const MAKAM_DISPLAY_NAMES = {
  CARGAH: "Cargah", BUSELIK: "Buselik", KURDI: "Kurdi", RAST: "Rast",
  HICAZ: "Hicaz", USSAK: "Ussak", NIHAVENT: "Nihavent", HUZZAM: "Huzzam",
  KARCIGAR: "Karcigar", SEGAH: "Segah", NEVA: "Neva", HUSEYNI: "Huseyni",
};

export const MAKAM_DISPLAY_NAMES_TR = {
  CARGAH: "Çargâh", BUSELIK: "Bûselik", KURDI: "Kürdî", RAST: "Râst",
  HICAZ: "Hicaz", USSAK: "Uşşak", NIHAVENT: "Nihavent", HUZZAM: "Hüzzam",
  KARCIGAR: "Karcığar", SEGAH: "Segâh", NEVA: "Nevâ", HUSEYNI: "Hüseynî",
};

export function komasToSemitones(komas) {
  return (komas * 12.0) / 53.0;
}

export function frequencyToKoma(frequency) {
  return (frequencyToMidi(frequency) * 53.0) / 12.0;
}

// Klasik perde adlari, Rast'a gore koma cinsinden konum.
export const PERDE_NAMES_KOMA = [
  [-22, "Yegah"],
  [0, "Rast"],
  [9, "Dugah"],
  [17, "Segah"],
  [22, "Cargah"],
  [31, "Neva"],
  [40, "Huseyni"],
  [48, "Evic"],
  [53, "Gerdaniye"],
  [62, "Muhayyer"],
  [75, "Tiz Cargah"],
];

// Rast perdesinin geleneksel/pedagojik yaklasik referansi: G3 (mutlak
// standart degil, egitim amacli goreli bir isimlendirme).
export const PERDE_REFERENCE_MIDI = 55.0;

export function nearestPerdeName(frequency) {
  const referenceKoma = (PERDE_REFERENCE_MIDI * 53.0) / 12.0;
  const komaPosition = frequencyToKoma(frequency) - referenceKoma;
  let bestName = "Rast";
  let bestDiff = 1e18;
  for (const [koma, name] of PERDE_NAMES_KOMA) {
    for (let octaveK = -3; octaveK <= 3; octaveK++) {
      const diff = komaPosition - (koma + 53 * octaveK);
      if (Math.abs(diff) < Math.abs(bestDiff)) {
        bestDiff = diff;
        bestName = name;
      }
    }
  }
  return [bestName, bestDiff * KOMA_CENTS];
}

// Tonikten (durak) itibaren 7 perdenin koma cinsinden konumu (0..52).
export function makamScaleDegreesKomas(name) {
  const intervals = MAKAM_SCALES_KOMA[name];
  const offsets = [0];
  let total = 0;
  for (let i = 0; i < intervals.length - 1; i++) {
    total += intervals[i];
    offsets.push(total);
  }
  return offsets;
}
