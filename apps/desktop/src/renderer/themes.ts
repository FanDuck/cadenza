/**
 * Built-in themes.
 *
 * A theme is just a bag of CSS custom properties. `applyTheme()` copies them
 * onto `<html>`, so every element - including the shadow DOM inside the UI kit
 * components - inherits the same palette.
 *
 * The token names are owned by `@fanduck/cadenza-ui` (`packages/ui/src/theme.css`).
 * Never invent a `--cz-*` token here: if a new one is needed, add it to the UI
 * kit's theme.css first, then to these themes.
 */

export interface Theme {
  id: string;
  name: string;
  description: string;
  scheme: "dark" | "light";
  /**
   * Value for `<html data-theme>`.
   * The UI kit ships a dark default and a `light` override; Synthwave is dark
   * with its own inline palette, so it uses the default (`null`).
   */
  dataTheme: string | null;
  vars: Record<string, string>;
}

export interface Accent {
  id: string;
  name: string;
  /** Primary accent color. */
  color: string;
  /** Secondary color used by gradients (album art, wordmark, active nav). */
  color2: string;
}

/** Every variable a theme may set. Used to clear the previous theme cleanly. */
const THEME_VARS = [
  "--cz-bg",
  "--cz-bg-soft",
  "--cz-surface",
  "--cz-surface-2",
  "--cz-surface-3",
  "--cz-border",
  "--cz-border-strong",
  "--cz-text",
  "--cz-text-dim",
  "--cz-text-mute",
  "--cz-accent",
  "--cz-accent-2",
  "--cz-accent-soft",
  "--cz-grad",
  "--cz-danger",
  "--cz-success",
  "--cz-radius",
  "--cz-radius-sm",
  "--cz-radius-pill",
  "--cz-shadow-1",
  "--cz-shadow-2",
  "--cz-font",
  "--cz-mono",
] as const;

const FONT_STACK = `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif`;
const MONO_STACK = `"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace`;

/** Midnight - the default: deep blue-black, calm, high contrast. */
export const MIDNIGHT: Theme = {
  id: "midnight",
  name: "Midnight",
  description: "Deep blue-black, made for late-night listening.",
  scheme: "dark",
  dataTheme: null,
  vars: {
    "--cz-bg": "#0b0d12",
    "--cz-bg-soft": "#0f121a",
    "--cz-surface": "#151926",
    "--cz-surface-2": "#1c2131",
    "--cz-surface-3": "#242b3e",
    "--cz-border": "#252c3d",
    "--cz-border-strong": "#364159",
    "--cz-text": "#e9eefc",
    "--cz-text-dim": "#b3bdd4",
    "--cz-text-mute": "#77839f",
    "--cz-accent": "#ffcc4d",
    "--cz-accent-2": "#ff9e4d",
    "--cz-accent-soft": "rgba(255, 204, 77, 0.16)",
    "--cz-grad": "linear-gradient(135deg, #ffcc4d, #ff9e4d)",
    "--cz-danger": "#ff6376",
    "--cz-success": "#4fd6a3",
    "--cz-radius": "14px",
    "--cz-radius-sm": "9px",
    "--cz-radius-pill": "999px",
    "--cz-shadow-1": "0 1px 2px rgba(0, 0, 0, 0.35)",
    "--cz-shadow-2": "0 22px 60px rgba(0, 0, 0, 0.5)",
    "--cz-font": FONT_STACK,
    "--cz-mono": MONO_STACK,
  },
};

/** Daylight - light, airy, for daytime listening on a bright screen. */
export const DAYLIGHT: Theme = {
  id: "daylight",
  name: "Daylight",
  description: "A light, paper-like palette for bright rooms.",
  scheme: "light",
  dataTheme: "light",
  vars: {
    "--cz-bg": "#f5f6fa",
    "--cz-bg-soft": "#eef1f7",
    "--cz-surface": "#ffffff",
    "--cz-surface-2": "#f6f8fc",
    "--cz-surface-3": "#e9edf5",
    "--cz-border": "#dde3ee",
    "--cz-border-strong": "#c5cede",
    "--cz-text": "#151a24",
    "--cz-text-dim": "#4b566b",
    "--cz-text-mute": "#7d8798",
    "--cz-accent": "#b45f06",
    "--cz-accent-2": "#d97706",
    "--cz-accent-soft": "rgba(180, 95, 6, 0.12)",
    "--cz-grad": "linear-gradient(135deg, #f59e0b, #b45f06)",
    "--cz-danger": "#c0263c",
    "--cz-success": "#0f8a5f",
    "--cz-radius": "14px",
    "--cz-radius-sm": "9px",
    "--cz-radius-pill": "999px",
    "--cz-shadow-1": "0 1px 2px rgba(20, 28, 45, 0.08)",
    "--cz-shadow-2": "0 22px 60px rgba(20, 28, 45, 0.16)",
    "--cz-font": FONT_STACK,
    "--cz-mono": MONO_STACK,
  },
};

/** Synthwave - neon on deep purple. */
export const SYNTHWAVE: Theme = {
  id: "synthwave",
  name: "Synthwave",
  description: "Neon magenta and cyan over deep purple.",
  scheme: "dark",
  dataTheme: null,
  vars: {
    "--cz-bg": "#120621",
    "--cz-bg-soft": "#180a2c",
    "--cz-surface": "#22103a",
    "--cz-surface-2": "#2b1448",
    "--cz-surface-3": "#371b59",
    "--cz-border": "#47246c",
    "--cz-border-strong": "#5f3189",
    "--cz-text": "#f6eaff",
    "--cz-text-dim": "#cbb2e6",
    "--cz-text-mute": "#9a7fbc",
    "--cz-accent": "#ff4fd8",
    "--cz-accent-2": "#00e5ff",
    "--cz-accent-soft": "rgba(255, 79, 216, 0.18)",
    "--cz-grad": "linear-gradient(135deg, #ff4fd8, #00e5ff)",
    "--cz-danger": "#ff5c7a",
    "--cz-success": "#5ef2b0",
    "--cz-radius": "14px",
    "--cz-radius-sm": "9px",
    "--cz-radius-pill": "999px",
    "--cz-shadow-1": "0 1px 2px rgba(0, 0, 0, 0.5)",
    "--cz-shadow-2": "0 22px 60px rgba(0, 0, 0, 0.65)",
    "--cz-font": FONT_STACK,
    "--cz-mono": MONO_STACK,
  },
};

export const THEMES: readonly Theme[] = [MIDNIGHT, DAYLIGHT, SYNTHWAVE];

/** Accent swatches offered in Settings. */
export const ACCENTS: readonly Accent[] = [
  { id: "duck", name: "Duck", color: "#ffcc4d", color2: "#ff9e4d" },
  { id: "teal", name: "Teal", color: "#2fd3c0", color2: "#38bdf8" },
  { id: "violet", name: "Violet", color: "#a78bfa", color2: "#818cf8" },
  { id: "magenta", name: "Magenta", color: "#ff5fa2", color2: "#ff4fd8" },
  { id: "blue", name: "Blue", color: "#5ea8ff", color2: "#3b82f6" },
  { id: "lime", name: "Lime", color: "#a3e635", color2: "#4ade80" },
  { id: "sunset", name: "Sunset", color: "#fb7185", color2: "#f97316" },
];

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? MIDNIGHT;
}

export function accentById(id: string): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0] ?? { id: "duck", name: "Duck", color: "#ffcc4d", color2: "#ff9e4d" };
}

/**
 * Apply a theme + accent to the document.
 *
 * Calling this repeatedly is cheap and safe: the previous inline tokens are
 * removed first, so switching themes never leaves stale colors behind.
 */
export function applyTheme(themeId: string, accentId: string): void {
  const theme = themeById(themeId);
  const accent = accentById(accentId);
  const root = document.documentElement;

  // 1. Clear tokens from the previous theme.
  for (const name of THEME_VARS) root.style.removeProperty(name);

  // 2. Tell the UI kit whether it should use its light palette.
  if (theme.dataTheme) root.setAttribute("data-theme", theme.dataTheme);
  else root.removeAttribute("data-theme");
  root.style.colorScheme = theme.scheme;

  // 3. Apply the overrides (also for Midnight / Daylight, so accent swatches and
  //    future theme tweaks work without editing theme.css).
  //    On a light theme the dark-friendly swatch colors are mixed darker so
  //    accent text and icons keep enough contrast on a near-white surface.
  const mixForScheme = (color: string): string =>
    theme.scheme === "light" ? `color-mix(in srgb, ${color} 58%, #10131a)` : color;
  const accentColor = mixForScheme(accent.color);
  const accentColor2 = mixForScheme(accent.color2);

  const vars: Record<string, string> = {
    ...theme.vars,
    "--cz-accent": accentColor,
    "--cz-accent-2": accentColor2,
    "--cz-accent-soft": `color-mix(in srgb, ${accentColor} 18%, transparent)`,
    "--cz-grad": `linear-gradient(135deg, ${accentColor}, ${accentColor2})`,
  };

  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);

  // 4. Expose the palette to CSS (e.g. the window chrome in app.css).
  root.dataset.czTheme = theme.id;
  root.dataset.czAccent = accent.id;
}
