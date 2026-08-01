// MUZIK TURU (GENRE) PRESETLERI
//
// harmoni.py'deki AutoArranger, tonalite + tempo + ritim hissine bakarak
// otomatik bir katman seti seciyordu (5 kural). Burada ayni fikir kullanicinin
// DOGRUDAN secebilecegi zengin bir tur listesine donusturuldu: her tur bir
// dizi/makam + enstruman kadrosu + tempo uclusudur. Tek tiklamayla tum
// orkestra o turun karakterine gore yeniden kurulur.
//
// layers degerleri LAYER_KEYS (constants/layers.js) ile ayni isimleri kullanir.

export const GENRES = [
  {
    id: "anadolu_rock",
    label: "Anadolu Rock",
    hint: "Bağlama + distorsiyonlu kadro",
    tonal: "western:dorian",
    layers: ["GITAR", "BASS", "DRUMS", "PIANO", "BAGLAMA"],
    bpm: 118,
  },
  {
    id: "rock",
    label: "Rock / Metal",
    hint: "Sert, frigyen renkli",
    tonal: "western:phrygian",
    layers: ["GITAR", "BASS", "DRUMS"],
    bpm: 132,
  },
  {
    id: "pop",
    label: "Pop",
    hint: "Parlak ve akıcı",
    tonal: "western:major",
    layers: ["PIANO", "BASS", "DRUMS", "STRINGS"],
    bpm: 108,
  },
  {
    id: "rap",
    label: "Rap / Hip-Hop",
    hint: "Ağır groove, koyu bas",
    tonal: "western:minor",
    layers: ["BASS", "DRUMS", "PAD", "PIANO"],
    bpm: 88,
  },
  {
    id: "tekno",
    label: "Tekno / Elektronik",
    hint: "Sürekli nabız, geniş pad",
    tonal: "western:minor",
    layers: ["BASS", "DRUMS", "PAD", "STRINGS"],
    bpm: 128,
  },
  {
    id: "turk_sanat",
    label: "Türk Sanat Müziği",
    hint: "Ney + keman, ağır ve zarif",
    tonal: "makam:RAST",
    layers: ["NEY", "BAGLAMA", "KEMAN", "PAD"],
    bpm: 72,
  },
  {
    id: "turk_halk",
    label: "Türk Halk / Etnik",
    hint: "Bağlama + davul, oyun havası",
    tonal: "makam:HUSEYNI",
    layers: ["BAGLAMA", "DAVUL", "BASS", "NEY"],
    bpm: 104,
  },
  {
    id: "arabesk",
    label: "Arabesk",
    hint: "Yaylılar öne çıkar, hüzünlü",
    tonal: "makam:HICAZ",
    layers: ["STRINGS", "KEMAN", "BAGLAMA", "DAVUL", "BASS"],
    bpm: 96,
  },
  {
    id: "dogu",
    label: "Arap / Doğu",
    hint: "Hicaz rengi, ney ve darbuka",
    tonal: "makam:HICAZ",
    layers: ["NEY", "STRINGS", "DAVUL", "BAGLAMA"],
    bpm: 92,
  },
  {
    id: "fars",
    label: "Fars / İran",
    hint: "Segâh rengi, içe dönük",
    tonal: "makam:SEGAH",
    layers: ["NEY", "KEMAN", "PAD", "DAVUL"],
    bpm: 76,
  },
  {
    id: "flamenko",
    label: "Flamenko / İspanyol",
    hint: "Hicaz gitar, vurmalı",
    tonal: "western:phrygian_dominant",
    layers: ["GITAR", "DAVUL", "BASS"],
    bpm: 110,
  },
  {
    id: "balkan",
    label: "Balkan",
    hint: "Nefesli kadro, hızlı",
    tonal: "western:harmonic_minor",
    layers: ["BRASS", "DRUMS", "GITAR", "BASS"],
    bpm: 140,
  },
  {
    id: "caz",
    label: "Caz / Jazz",
    hint: "Piyano trio, salınımlı",
    tonal: "western:mixolydian",
    layers: ["PIANO", "BASS", "DRUMS"],
    bpm: 116,
  },
  {
    id: "blues",
    label: "Blues",
    hint: "Gitar öncülüğünde, ağır",
    tonal: "western:blues",
    layers: ["GITAR", "BASS", "DRUMS", "PIANO"],
    bpm: 84,
  },
  {
    id: "klasik",
    label: "Klasik Orkestra",
    hint: "Yaylı + nefesli + bakır",
    tonal: "western:major",
    layers: ["STRINGS", "WOODWINDS", "BRASS", "PIANO"],
    bpm: 92,
  },
  {
    id: "uzakdogu",
    label: "Uzak Doğu",
    hint: "Pentatonik, dingin",
    tonal: "western:pentatonic_major",
    layers: ["NEY", "BAGLAMA", "PAD"],
    bpm: 80,
  },
  {
    id: "ambient",
    label: "Ambient / Meditatif",
    hint: "Sadece dokular, çok yavaş",
    tonal: "western:pentatonic_major",
    layers: ["PAD", "STRINGS", "NEY"],
    bpm: 60,
  },
];

export function getGenre(id) {
  return GENRES.find((g) => g.id === id) || null;
}
