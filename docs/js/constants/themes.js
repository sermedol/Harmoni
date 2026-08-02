// Harmoni gorsel dili: "Biophilic Instrument".
//
// Tek bir tema var. Onceki dort tema (midnight/studio/anadolu/daylight)
// uygulamada hic secilemiyordu - config.theme_index sabit 0'a zorlaniyor ve
// arayuzdeki secici tek secenek gosteriyordu. Olu tanimlar kaldirildi.
//
// Ayni anahtarlar korunuyor (bg/panel/panel2/text/muted/primary/secondary/
// accent/danger/success/warning) cunku canvas-hud.js, hand-skeleton.js ve
// ambient-scene.js bu nesneyi dogrudan kullaniyor. Degerler theme.css
// icindeki CSS tokenlariyla birebir ayni tutulmalidir.
export const THEMES = [
  {
    key: "biophilic",
    name: "Biophilic",
    // Derin orman / petrol yesili zemin.
    bg: "#06100F",
    panel: "#0A1916",
    panel2: "#11302B",
    // Metin.
    text: "#F3F1E8",
    muted: "#A9B7B0",
    disabled: "#71817B",
    // Malzemeler: kuvars, yosun, cicek.
    primary: "#DDF1E9",   // kuvars - ana vurgu
    secondary: "#A8C983", // yosun
    accent: "#E6B4C5",    // pembe cicek
    flower: "#DDD39E",    // kirik sari cicek
    // Durum renkleri.
    success: "#B8E68B",
    warning: "#E5C276",
    danger: "#F17178",
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
