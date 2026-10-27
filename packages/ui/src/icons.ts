/**
 * The Cadenza icon sprite.
 *
 * Icons are stored as trusted, static SVG fragments on a 24x24 grid. User data
 * never reaches this file, so injecting the fragment with `innerHTML` is safe;
 * every other component still uses `textContent` / `setAttribute` for data.
 *
 * `<cz-icon>` and the internal `iconSvg()` helper share this table so the whole
 * kit draws from the same 1.8px round-cap stroke language.
 */

export const ICON_NAMES = [
  "play",
  "pause",
  "next",
  "prev",
  "shuffle",
  "repeat",
  "repeat-one",
  "volume",
  "volume-off",
  "search",
  "library",
  "album",
  "artist",
  "playlist",
  "settings",
  "plus",
  "minus",
  "close",
  "minimize",
  "maximize",
  "restore",
  "queue",
  "lyrics",
  "folder",
  "music",
  "more",
  "check",
  "chevron-down",
  "chevron-right",
  "heart",
  "trash",
  "drag",
  "palette",
  "info",
  "external",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export const ICONS: Readonly<Record<IconName, string>> = {
  play: '<path d="M8.5 5.2 19 12 8.5 18.8V5.2Z"/>',
  pause: '<path d="M9 5.5v13"/><path d="M15 5.5v13"/>',
  next: '<path d="M6 5.4 15.5 12 6 18.6V5.4Z"/><path d="M18.5 5v14"/>',
  prev: '<path d="M18 5.4 8.5 12 18 18.6V5.4Z"/><path d="M5.5 5v14"/>',
  shuffle:
    '<path d="M3 6h3.2c1.8 0 3 1 4.3 3l3 4c1.3 2 2.5 3 4.3 3H21"/><path d="m17.5 12.5 3.5 3.5-3.5 3.5"/><path d="M3 18h3.2c1.8 0 3-1 4.3-3"/><path d="m17.5 2.5 3.5 3.5-3.5 3.5"/>',
  repeat:
    '<path d="m17 2.5 3.5 3.5L17 9.5"/><path d="M3 11.5V10a4 4 0 0 1 4-4h13.5"/><path d="m7 21.5-3.5-3.5L7 14.5"/><path d="M21 12.5V14a4 4 0 0 1-4 4H3.5"/>',
  "repeat-one":
    '<path d="m17 2.5 3.5 3.5L17 9.5"/><path d="M3 11.5V10a4 4 0 0 1 4-4h13.5"/><path d="m7 21.5-3.5-3.5L7 14.5"/><path d="M21 12.5V14a4 4 0 0 1-4 4H3.5"/><path d="M11.4 10.6h1.2v3.4"/>',
  volume:
    '<path d="M11 4.8 6.4 8.8H2.8v6.4h3.6l4.6 4V4.8Z"/><path d="M15 9a4.2 4.2 0 0 1 0 6"/><path d="M17.8 6.2a8 8 0 0 1 0 11.6"/>',
  "volume-off":
    '<path d="M11 4.8 6.4 8.8H2.8v6.4h3.6l4.6 4V4.8Z"/><path d="m15.5 9.5 5 5"/><path d="m20.5 9.5-5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.7"/><path d="m20.5 20.5-4.6-4.6"/>',
  library:
    '<path d="M5.2 20.2A2.6 2.6 0 0 1 7.8 17.6H20"/><path d="M7.8 2.5H20v19H7.8A2.6 2.6 0 0 1 5.2 19V5.1a2.6 2.6 0 0 1 2.6-2.6Z"/>',
  album: '<circle cx="12" cy="12" r="8.7"/><circle cx="12" cy="12" r="2.6"/>',
  artist: '<circle cx="12" cy="8" r="4.2"/><path d="M4.5 20.2a7.5 7.5 0 0 1 15 0"/>',
  playlist:
    '<path d="M3 6.5h11"/><path d="M3 12h11"/><path d="M3 17.5h6.5"/><path d="M18 15.2v5.6"/><circle cx="16" cy="20.4" r="1.9"/><path d="m18 15.2 3.5-1.4v4.4"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/>',
  restore:
    '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16.5 8V6.5a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H8"/>',
  queue:
    '<path d="M3.5 6h13"/><path d="M3.5 12h9"/><path d="M3.5 18h9"/><path d="m16.5 15.5 4 2.5-4 2.5v-5Z"/>',
  lyrics:
    '<path d="M6 3.5h8.5L19 8v12.5H6V3.5Z"/><path d="M14.5 3.5V8H19"/><path d="M9 12.5h6"/><path d="M9 16.5h4"/>',
  folder:
    '<path d="M3.5 7.2a2 2 0 0 1 2-2h3.6l2 2.2h8.4a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2V7.2Z"/>',
  music:
    '<path d="M9 18V5.8l11-2.1v12.1"/><circle cx="6.4" cy="18" r="2.6"/><circle cx="17.4" cy="15.8" r="2.6"/>',
  more: '<circle cx="5.5" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18.5" cy="12" r="1.1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 6.5"/>',
  "chevron-down": '<path d="m6 9.5 6 6 6-6"/>',
  "chevron-right": '<path d="m9.5 6 6 6-6 6"/>',
  heart: '<path d="M20.6 5.9a5 5 0 0 0-7.1 0L12 7.4l-1.5-1.5a5 5 0 1 0-7.1 7.1L12 21l8.6-8a5 5 0 0 0 0-7.1Z"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9.5 7V4.2h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10.5 11v5.5"/><path d="M13.5 11v5.5"/>',
  drag: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  palette:
    '<path d="M12 3.2a8.8 8.8 0 0 0 0 17.6 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2h1.9a3.7 3.7 0 0 0 3.7-3.7A8.8 8.8 0 0 0 12 3.2Z"/><circle cx="7.6" cy="10.2" r="1"/><circle cx="12" cy="7.4" r="1"/><circle cx="16.4" cy="10.2" r="1"/>',
  info: '<circle cx="12" cy="12" r="8.7"/><path d="M12 11v5.5"/><path d="M12 8h.01"/>',
  external:
    '<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18.5 14.5v4a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5h4"/>',
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** Coerce arbitrary input to a known icon name, falling back to `music`. */
export function resolveIconName(name: string | null | undefined): IconName {
  if (name && Object.prototype.hasOwnProperty.call(ICONS, name)) {
    return name as IconName;
  }
  return "music";
}

function applyIconAttributes(svg: SVGSVGElement, size: number): void {
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
}

/**
 * Build a standalone `<svg>` for an icon. Used internally by components that do
 * not want to depend on `<cz-icon>` being registered; the markup is static and
 * trusted.
 */
export function iconSvg(name: string, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  applyIconAttributes(svg, size);
  svg.innerHTML = ICONS[resolveIconName(name)];
  return svg;
}

/** Update an existing icon element in place (keeps callers from rebuilding DOM). */
export function paintIcon(svg: SVGSVGElement, name: string, size: number): void {
  applyIconAttributes(svg, size);
  svg.innerHTML = ICONS[resolveIconName(name)];
}
