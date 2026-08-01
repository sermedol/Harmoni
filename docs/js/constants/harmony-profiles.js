// harmoni.py: Krumhansl-Schmuckler anahtar profilleri + makam derece
// agirliklari - birebir port.

export const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Bati fonksiyonel armonisinde 7 dizi derecesinin (0=I) kisa etiketleri;
// egitim amacli HUD gosterimi icindir, ses motorunu etkilemez.
export const WESTERN_DEGREE_LABELS = ["Tonik", "II", "III", "Subdominant", "Dominant", "VI", "VII"];

// Makam-profili korelasyonunda durak (0) ve gucluye (4) agirlik veren
// derece agirliklari.
export const MAKAM_DEGREE_WEIGHTS = [3.0, 1.0, 1.3, 1.5, 2.2, 1.0, 1.4];
