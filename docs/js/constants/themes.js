// harmoni.py THEMES tablosunun birebir portu (BGR -> RGB donusumu ile).
export const THEMES = [
  {
    key: "midnight",
    name: "Bordo",
    bg: "#0d080a", panel: "#1a1115", panel2: "#38232c",
    text: "#f5ecef", muted: "#b9a4ac",
    primary: "#d94b64", secondary: "#8f2942", accent: "#e7a0ae",
    danger: "#ff5c70", success: "#86b39a", warning: "#d68a55",
    dark: true,
  },
  {
    key: "studio",
    name: "Studio",
    bg: "#141211", panel: "#201d1b", panel2: "#403a34",
    text: "#f0ebe1", muted: "#beb4aa",
    primary: "#f59e0b", secondary: "#fb7142", accent: "#2dd4bf",
    danger: "#ef4444", success: "#a3e635", warning: "#facc15",
    dark: true,
  },
  {
    key: "anadolu",
    name: "Anadolu",
    bg: "#18110f", panel: "#261b17", panel2: "#4a382e",
    text: "#f5e8dc", muted: "#c4ac9e",
    primary: "#e07a3f", secondary: "#2da699", accent: "#e8b54a",
    danger: "#d64541", success: "#8cbd58", warning: "#e69f4a",
    dark: true,
  },
  {
    key: "daylight",
    name: "Daylight",
    bg: "#f5f6f8", panel: "#ffffff", panel2: "#e2e5ea",
    text: "#1e2128", muted: "#6e7480",
    primary: "#4f46e5", secondary: "#0ea5e9", accent: "#d97706",
    danger: "#dc2626", success: "#16a34a", warning: "#ca8a04",
    dark: false,
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
