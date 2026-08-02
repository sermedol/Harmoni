// Harmoni gorsel dili: "Burgundy Botanical Instrument".
//
// TEK RENK KAYNAGI. Canvas modulleri (canvas-hud, ambient-scene,
// hand-skeleton, draw-utils) rengi buradan alir; hicbirinde sabit renk
// yazili degildir. Degerler docs/styles/theme.css tokenlariyla birebir
// ayni tutulmalidir.
//
// Palet (kullanicinin verdigi renk karti):
//   Night Rider      #020101  ana zemin, en koyu overlay
//   Aubergine        #3D0B0D  ana panel yuzeyi
//   Mahogany         #53080E  yukseltilmis kontroller
//   Dark Burgundy    #72090F  aktif sinir, ince cizgi
//   Pohutukawa       #930510  ana vurgu, aktif deger
//   Roof Terracotta  #B21F29  sinirli parlak vurgu, kayit
//
// OKUNABILIRLIK NOTU: koyu bordolar YUZEY, SINIR ve DOLGU rolundedir.
// Kamera goruntusu uzerine cizilen INCE CIZGI ve METIN icin bu tonlar
// yeterli kontrast vermez; onlar icin acik gul tonlari kullanilir.
// Estetik hicbir zaman okunabilirligin onune gecmez.
//
// DURUM RENKLERI: palet tamamen kirmizi ailesinde oldugu icin "hazir",
// "bekliyor" ve "hata" YALNIZCA renkle ayirt edilemez. Bu yuzden her
// durum ayrica METIN ve BICIM (dolu nokta / halka / REC etiketi) ile
// anlatilir - bkz. canvas-hud.js drawIdentity ve layout.css .hand-status.
export const THEMES = [
  {
    key: "burgundy",
    name: "Burgundy Botanical",

    // --- Zemin ve yuzeyler ---
    backgroundDeep: "#020101",
    backgroundSurface: "#3D0B0D",
    surfaceRaised: "#53080E",
    surfaceGlass: "rgba(61, 11, 13, 0.42)",
    surfaceStrong: "rgba(83, 8, 14, 0.62)",
    border: "rgba(246, 238, 238, 0.12)",
    borderStrong: "rgba(178, 31, 41, 0.38)",

    // --- Metin ---
    textPrimary: "#F6EEEE",
    textSecondary: "#CDBABC",
    textDisabled: "#917A7D",

    // --- Botanik / atmosfer ---
    botanicalDark: "#3D0B0D",
    botanicalMid: "#53080E",
    petalDark: "#72090F",
    petalBright: "#B21F29",
    petalDust: "#E8C9CC",

    // --- El iskeleti ---
    handLine: "#EFD6D8",   // soluk gul: kamera uzerinde rahat secilir
    handJoint: "#B21F29",

    // --- Durum ---
    recording: "#B21F29",
    error: "#B21F29",
    warning: "#C9776B",
    ready: "#E8C9CC",

    // =====================================================================
    // ESKI ANAHTAR KOPRUSU
    // canvas-hud.js ve hand-skeleton.js bu adlari kullaniyor. Yeni role
    // adlarina eslenmisdir; boylece her cagri yerini degistirmeden tek
    // kaynaktan renk almaya devam ederler.
    // =====================================================================
    bg: "#020101",
    panel: "#3D0B0D",
    panel2: "#53080E",
    text: "#F6EEEE",
    muted: "#CDBABC",
    disabled: "#917A7D",
    // primary: HUD'un kamera uzerine cizdigi ince cizgiler (dalga formu,
    // vurus noktalari, netlik yayi). Koyu bordo burada okunmaz.
    primary: "#E8C9CC",
    secondary: "#B21F29",
    // accent: akor meta satiri gibi kucuk metinler - okunabilir gul tonu.
    accent: "#D9989E",
    danger: "#B21F29",
    success: "#E8C9CC",
    flower: "#D9989E",
    dark: true,
  },
];

export function applyTheme(index) {
  const theme = THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length];
  document.documentElement.setAttribute("data-theme", theme.key);
  return theme;
}

export function getTheme(index) {
  return THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length];
}
