// Canvas themes. Colours live in styles.css (one token block per theme); this list drives the
// picker, the background grid style and how exports draw icons.
export type ThemeId = "dark" | "midnight" | "light" | "paper" | "blueprint";

export interface Theme {
  id: ThemeId;
  label: string;
  hint: string;
  tone: "dark" | "light";
  grid: "dots" | "lines" | "none";
  icons: "color" | "darken" | "white"; // how brand-coloured icons are drawn in exports
  swatch: [string, string, string]; // canvas, node, accent (for the picker)
}

export const THEMES: Theme[] = [
  { id: "dark", label: "Dark", hint: "n8n canvas", tone: "dark", grid: "dots", icons: "color", swatch: ["#2a2a2a", "#404143", "#ff6d5a"] },
  { id: "midnight", label: "Midnight", hint: "indigo + neon", tone: "dark", grid: "dots", icons: "color", swatch: ["#0d0e1f", "#1a1c42", "#e879f9"] },
  { id: "light", label: "Light", hint: "soft grey", tone: "light", grid: "dots", icons: "darken", swatch: ["#f4f4f6", "#ffffff", "#ff6d5a"] },
  { id: "paper", label: "Paper", hint: "white, for documents & print", tone: "light", grid: "none", icons: "darken", swatch: ["#ffffff", "#ffffff", "#2563eb"] },
  { id: "blueprint", label: "Blueprint", hint: "engineering drawing", tone: "dark", grid: "lines", icons: "white", swatch: ["#0b3a82", "#0e4596", "#ffd166"] },
];

export const themeOf = (id: string | undefined | null): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Read a theme's colour tokens without repainting: swap the attribute, read, restore (same frame). */
export function themeTokens(id: ThemeId): Record<string, string> {
  const root = document.documentElement;
  const prev = root.dataset.theme;
  root.dataset.theme = id;
  const cs = getComputedStyle(root);
  const keys = ["bg", "dot", "node-bg", "sub-bg", "node-border", "edge", "edge-active", "text", "muted", "accent", "on-accent",
    "handle", "icon-neutral", "ok", "warn", "bad", "info"];
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = cs.getPropertyValue(`--${k}`).trim();
  if (prev) root.dataset.theme = prev;
  else delete root.dataset.theme;
  return out;
}

/** Darken a #rrggbb colour (for brand icons on white). */
export function darken(hex: string, f = 0.32): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - f)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
