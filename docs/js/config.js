// harmoni.py: DEFAULT_CONFIG / load_config / save_config - localStorage portu.
// camera_index ve resolution alanlari dusuruldu (tarayicida analogu yok,
// getUserMedia cihaz/cozunurluk secimini kendi yonetir).

export const DEFAULT_CONFIG = {
  theme_index: 0,
  piano_volume: 0.30,
  performance: "balanced",
  monitor_enabled: true,
  mirror: true,
  simple_mode: true,
  // "western:auto" | "western:<mod>" | "makam:<AD>"  (bkz. tonal-systems.js)
  tonal_selection: "western:auto",
  // genres.js icindeki bir tur kimligi; bos ise "serbest" (kullanici kendi secti)
  genre_id: "anadolu_rock",
};

const STORAGE_KEY = "harmoni_config";

export function loadConfig(key = STORAGE_KEY) {
  const config = { ...DEFAULT_CONFIG };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        for (const k of Object.keys(DEFAULT_CONFIG)) {
          if (k in data) config[k] = data[k];
        }
      }
    }
  } catch {
    // Bozuk/erisilemez localStorage - sessizce varsayilanlara don.
  }
  return config;
}

export function saveConfig(config, key = STORAGE_KEY) {
  try {
    const payload = {};
    for (const k of Object.keys(DEFAULT_CONFIG)) {
      payload[k] = k in config ? config[k] : DEFAULT_CONFIG[k];
    }
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Yazma basarisiz (orn. gizli sekme kotasi) - sessizce yok say.
  }
}
