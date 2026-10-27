/**
 * Tiny DOM toolkit.
 *
 * Cadenza never builds markup with `innerHTML`: everything is created with
 * `h(tag, props, ...children)`. Track titles, album names and plugin metadata
 * are user-controlled data, so keeping them out of HTML strings removes a whole
 * class of injection bugs (and the strict CSP forbids `eval`/inline scripts
 * anyway).
 *
 * The helper is intentionally boring. If you know `document.createElement`,
 * you already know this file.
 */

/** Anything that can be appended as a child. `null`/`undefined`/`false` are ignored. */
export type Child = Node | string | number | boolean | null | undefined;

/** Event handlers keyed by event name. */
export type EventHandlers = {
  [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
};

/** Attributes applied to an element. */
export interface Props {
  class?: string;
  id?: string;
  /** Convenience for `textContent` (always set as text, never parsed as HTML). */
  text?: string;
  title?: string;
  role?: string;
  tabIndex?: number;
  /** Raw `cssText`. Only ever used with computed values, never user input. */
  style?: string;
  href?: string;
  src?: string;
  alt?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  draggable?: boolean;
  /** `aria-*` attributes: `{ label: "Play" }` becomes `aria-label="Play"`. */
  aria?: Record<string, string | number | boolean | null | undefined>;
  /** `data-*` attributes: `{ view: "library" }` becomes `data-view="library"`. */
  dataset?: Record<string, string | number | boolean | null | undefined>;
  /** Any other attribute, e.g. `{ spellcheck: "false", "cz-variant": "full" }`. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: EventHandlers;
}

/** Create an element. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

/** Apply a `Props` object to an existing element. Useful when patching a node. */
export function applyProps(el: HTMLElement, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;

    if (key === "text") {
      el.textContent = String(value);
      continue;
    }

    if (key === "aria") {
      const aria = value as Props["aria"];
      if (aria) for (const [name, val] of Object.entries(aria)) setAttribute(el, `aria-${toKebab(name)}`, val);
      continue;
    }

    if (key === "dataset") {
      const data = value as Props["dataset"];
      if (data) for (const [name, val] of Object.entries(data)) setAttribute(el, `data-${toKebab(name)}`, val);
      continue;
    }

    if (key === "attrs") {
      const attrs = value as Props["attrs"];
      if (attrs) for (const [name, val] of Object.entries(attrs)) setAttribute(el, name, val);
      continue;
    }

    if (key === "on") {
      const handlers = value as EventHandlers;
      for (const [type, handler] of Object.entries(handlers)) {
        if (handler) el.addEventListener(type, handler as EventListener);
      }
      continue;
    }

    if (key === "style") {
      el.style.cssText = String(value);
      continue;
    }

    // Boolean attributes (`disabled`, `checked`, ...) become present/absent.
    if (value === true) {
      setAttribute(el, key, true);
      continue;
    }

    // Everything else is a normal attribute. Attributes (not properties) keep
    // custom elements and `<input value>` behaving predictably.
    setAttribute(el, key, value);
  }
}

function setAttribute(el: HTMLElement, name: string, value: string | number | boolean | null | undefined): void {
  if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
    return;
  }
  el.setAttribute(name, value === true ? "" : String(value));
}

/** `settingsSection` -> `settings-section` (the DOM attribute spelling). */
function toKebab(name: string): string {
  return name.replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`);
}

/** Append children in order, ignoring the empty ones. */
export function appendChildren(el: HTMLElement, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "number" ? String(child) : child instanceof Node ? child : String(child));
  }
}

/** Create a DocumentFragment from children (handy for bulk appends). */
export function frag(...children: Child[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment as unknown as HTMLElement, children);
  return fragment;
}

/** Remove every child of `el`. */
export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

/** Replace the children of `el` with a new set. */
export function fill(el: HTMLElement, ...children: Child[]): void {
  el.replaceChildren(...children.filter(isRenderable) as Array<Node | string>);
}

function isRenderable(child: Child): child is Node | string | number {
  return child !== null && child !== undefined && child !== false && child !== true;
}

/** Set text content, leaving the element alone when nothing changed. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Add a listener and return its unsubscribe function. */
export function on<K extends keyof HTMLElementEventMap>(
  target: EventTarget,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler as EventListener, options);
  return () => target.removeEventListener(type, handler as EventListener, options);
}

/** Add a listener for the low-frequency events that have no `HTMLElementEventMap` entry. */
export function onMedia(
  target: HTMLMediaElement,
  type: "timeupdate" | "durationchange" | "ended" | "error" | "playing" | "pause",
  handler: (event: Event) => void,
): () => void {
  return on(target, type as keyof HTMLElementEventMap, handler);
}

/** `document.querySelector` with an element type. */
export function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

/** Find a single element or throw: used for hosts that must exist (e.g. `#app`). */
export function mustFind<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Cadenza renderer: required element ${selector} is missing`);
  return el;
}

/** Add/remove a class without touching the rest of the class list. */
export function setClass(el: Element, name: string, enabled: boolean): void {
  el.classList.toggle(name, enabled);
}

/** Toggle a boolean attribute (`aria-pressed`, `aria-expanded`, ...). */
export function setPressed(el: HTMLElement, pressed: boolean): void {
  el.setAttribute("aria-pressed", pressed ? "true" : "false");
}

let uidCounter = 0;

/** Monotonic id for labels/controls that need `aria-*` links. */
export function uid(prefix = "cz"): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

/* ------------------------------------------------------------------ icons */

/**
 * The app chrome (title bar, sidebar, toolbars, palette) needs a handful of
 * icons. The UI kit ships its own icons for component internals; these are the
 * ones the shell owns. They are inline SVG built with `createElementNS`, so
 * there is still no `innerHTML` anywhere in the renderer.
 */
export type IconName =
  | "library"
  | "albums"
  | "artists"
  | "playlists"
  | "plugins"
  | "settings"
  | "search"
  | "queue"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "plus"
  | "folder"
  | "refresh"
  | "trash"
  | "more"
  | "close"
  | "minimize"
  | "maximize"
  | "restore"
  | "sort"
  | "play"
  | "pause"
  | "previous"
  | "next"
  | "shuffle"
  | "repeat"
  | "repeat-one"
  | "volume"
  | "volume-mute"
  | "heart"
  | "music"
  | "disc"
  | "clock"
  | "external"
  | "check"
  | "grid"
  | "mic"
  | "edit";

const ICON_PATHS: Record<IconName, readonly string[]> = {
  library: ["M4 5v14", "M8 7h12", "M8 12h12", "M8 17h8"],
  albums: [
    "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    "M14.2 12a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0",
  ],
  artists: ["M12 3a4 4 0 0 1 2.5 7.1V13a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2V10A4 4 0 0 1 12 3", "M6 13a6 6 0 0 0 12 0", "M12 19v2", "M9 22h6"],
  playlists: ["M4 6h9", "M4 11h9", "M4 16h6", "M18 20V9l3-1", "M18 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0"],
  plugins: ["M9 4v3", "M15 4v3", "M7 7h10v3a5 5 0 0 1-10 0z", "M12 15v6"],
  settings: ["M4 8h9", "M17 8h3", "M4 16h3", "M11 16h9", "M15.5 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0", "M11.5 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0"],
  search: ["M20 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0", "M16 16l4.5 4.5"],
  queue: ["M4 7h11", "M4 12h11", "M4 17h6", "M18 9v9", "M18 18a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0"],
  "chevron-left": ["M15 5l-7 7 7 7"],
  "chevron-right": ["M9 5l7 7-7 7"],
  "chevron-down": ["M6 9l6 6 6-6"],
  plus: ["M12 5v14", "M5 12h14"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  refresh: ["M20 8a8 8 0 1 0 1 6", "M21 4v5h-5"],
  trash: ["M4 7h16", "M9 7V5h6v2", "M6 7l1 13h10l1-13", "M10 11v6", "M14 11v6"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  minimize: ["M5 12h14"],
  maximize: ["M5 5h14v14H5z"],
  restore: ["M8 8h11v11H8z", "M5 5h11v3", "M5 5v11h3"],
  sort: ["M4 7h12", "M4 12h8", "M4 17h4", "M17 6v12", "M14 15l3 3 3-3"],
  play: ["M8 5l11 7-11 7z"],
  pause: ["M8 5v14", "M16 5v14"],
  previous: ["M6 5v14", "M18 5l-9 7 9 7z"],
  next: ["M18 5v14", "M6 5l9 7-9 7z"],
  shuffle: ["M16 4h4v4", "M4 20l16-16", "M20 16v4h-4", "M4 4l5 5", "M15 15l5 5"],
  repeat: ["M17 3l4 4-4 4", "M3 12v-2a2 2 0 0 1 2-2h16", "M7 21l-4-4 4-4", "M21 12v2a2 2 0 0 1-2 2H3"],
  "repeat-one": ["M17 3l4 4-4 4", "M3 12v-2a2 2 0 0 1 2-2h16", "M7 21l-4-4 4-4", "M21 12v2a2 2 0 0 1-2 2H3", "M11 10h1.5v5", "M11 15h3"],
  volume: ["M4 10v4h3l4 3V7l-4 3z", "M15 9.5a4 4 0 0 1 0 5", "M17.8 6.8a8 8 0 0 1 0 10.4"],
  "volume-mute": ["M4 10v4h3l4 3V7l-4 3z", "M16 9l4 6", "M20 9l-4 6"],
  heart: ["M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z"],
  music: ["M9 18V6l11-2v12", "M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0", "M20 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0"],
  disc: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", "M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"],
  clock: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", "M12 7v5l3 2"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"],
  check: ["M5 12l5 5L20 7"],
  grid: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  mic: ["M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3", "M6 11a6 6 0 0 0 12 0", "M12 17v3", "M9 20h6"],
  edit: ["M4 20h4L20.5 7.5a2.1 2.1 0 0 0-3-3L5 17v3z", "M14.5 5.5l4 4"],
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build an inline SVG icon. Decorative by default (`aria-hidden`). */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
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
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** The Cadenza duck mark: body, head and beak as one filled silhouette. */
export function duckGlyph(size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute(
    "d",
    "M2.4 15.4c0-2.9 4.3-5.2 9.6-5.2 4.8 0 8.6 1.8 9 4.4.2 1-.5 1.9-1.5 2.1-3.4.7-6.9 1-9.9 2.1-1.6.6-3 1.4-4.3 2.4-.5.4-1.2.2-1.3-.4-.7-1.8-1.6-3.6-1.6-5.4z",
  );
  const head = document.createElementNS(SVG_NS, "circle");
  head.setAttribute("cx", "17.3");
  head.setAttribute("cy", "8.4");
  head.setAttribute("r", "3.5");
  const beak = document.createElementNS(SVG_NS, "path");
  beak.setAttribute("d", "M20.3 7.9l3.2-1.1-2.4 2.8z");
  const eye = document.createElementNS(SVG_NS, "circle");
  eye.setAttribute("class", "duck-eye");
  eye.setAttribute("cx", "18.4");
  eye.setAttribute("cy", "7.3");
  eye.setAttribute("r", "0.8");

  svg.append(body, head, beak, eye);
  return svg;
}

