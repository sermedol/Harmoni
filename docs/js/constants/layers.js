// harmoni.py: LAYER_KEYS / LAYER_KEY_BY_NAME / LAYER_LABEL_BY_NAME - birebir port.

export const LAYER_KEYS = {
  p: ["PIANO", "Piyano"],
  b: ["BAGLAMA", "Baglama"],
  n: ["NEY", "Ney"],
  w: ["WOODWINDS", "Nefesli"],
  c: ["BRASS", "Bakir nefesli"],
  y: ["STRINGS", "Yaylilar"],
  k: ["KEMAN", "Keman"],
  g: ["GITAR", "Gitar"],
  j: ["PAD", "Pad"],
  l: ["BASS", "Bas"],
  i: ["DRUMS", "Ritim (bateri)"],
  z: ["DAVUL", "Davul"],
};

export const LAYER_KEY_BY_NAME = {};
export const LAYER_LABEL_BY_NAME = {};
for (const [key, [layer, label]] of Object.entries(LAYER_KEYS)) {
  LAYER_KEY_BY_NAME[layer] = key;
  LAYER_LABEL_BY_NAME[layer] = label;
}

export const ALL_LAYERS = Object.values(LAYER_KEYS).map(([layer]) => layer);
