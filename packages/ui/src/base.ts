/**
 * The root of every Cadenza element.
 *
 * Design goals:
 *  - one shadow root per element, one adopted stylesheet per element *class*
 *    (built once, reused by every instance);
 *  - property setters only ever call `invalidate()`, which coalesces into a
 *    single render per microtask. The player pushes position updates ~4x per
 *    second, so a render must stay cheap and must never be per-assignment;
 *  - a `<style>` fallback for engines without constructable stylesheets
 *    (jsdom, older WebViews) so the kit degrades gracefully;
 *  - no user data is ever interpolated into HTML: components write values with
 *    `textContent` / `setAttribute` only.
 */

import { BASE_STYLES } from "./styles.js";

/*
 * Structural mirrors of the frozen `@fanduck/cadenza-core` contract
 * (packages/core/src/types.ts).
 *
 * The UI package declares no build dependency on core: the contract is types
 * only, and package.json/tsconfig are outside this package's ownership. Mirroring
 * the exact shape keeps `Track` / `PlayerSnapshot` / `LyricsDoc` assignable in
 * both directions for host applications, while leaving the UI build standalone.
 * These types are intentionally NOT re-exported from index.ts.
 */

export type TrackId = string;

export type RepeatMode = "off" | "all" | "one";

export type PlaybackState = "idle" | "loading" | "playing" | "paused" | "stopped" | "error";

export interface Track {
  id: TrackId;
  path: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  size?: number;
  coverId?: string;
  addedAt: number;
  playCount?: number;
  lastPlayedAt?: number;
  origin?: "scan" | "playlist" | "plugin";
}

export interface PlayerSnapshot {
  state: PlaybackState;
  track: Track | null;
  position: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  error: string | null;
}

export interface LrcLine {
  time: number;
  text: string;
}

export interface LyricsDoc {
  lines: LrcLine[];
  offset: number;
  source: "sidecar" | "embedded" | "plugin";
  raw?: string;
}

interface ElementClass {
  new (): CzElement;
  styles?: string;
  observedAttributes?: string[];
}

interface StyleEntry {
  text: string;
  sheet: CSSStyleSheet | null;
}

const STYLE_CACHE = new WeakMap<ElementClass, StyleEntry>();

let constructableSupport: boolean | null = null;

/** Does this engine support `new CSSStyleSheet()` + `replaceSync` + adoption? */
function supportsConstructableSheets(): boolean {
  if (constructableSupport !== null) return constructableSupport;
  constructableSupport = false;
  try {
    if (typeof CSSStyleSheet === "undefined") return false;
    if (typeof ShadowRoot === "undefined") return false;
    if (typeof CSSStyleSheet.prototype.replaceSync !== "function") return false;
    if (!("adoptedStyleSheets" in ShadowRoot.prototype)) return false;
    const probe = new CSSStyleSheet();
    probe.replaceSync(":host{color:inherit}");
    constructableSupport = true;
  } catch {
    constructableSupport = false;
  }
  return constructableSupport;
}

/** Normalise whatever a setter receives into a finite number. */
function toFinite(value: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export abstract class CzElement extends HTMLElement {
  /** Styles specific to an element class, appended after the shared base CSS. */
  static styles: string = "";

  /** Attributes the element reacts to. Subclasses override with their own list. */
  static get observedAttributes(): string[] {
    return [];
  }

  protected readonly root: ShadowRoot;

  private renderQueued = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.applyStyles();
    // Render on the next microtask: subclass field initializers have run by then.
    this.invalidate();
  }

  /** Re-render on connect (e.g. after being moved in the DOM). */
  connectedCallback(): void {
    this.invalidate();
  }

  disconnectedCallback(): void {
    // Subclasses with timers or animation loops override this.
  }

  /** Bridge observed attributes onto properties. Subclasses override the switch. */
  attributeChangedCallback(_attributeName: string, _oldValue: string | null, _newValue: string | null): void {
    // no-op by default
  }

  /** Subclasses build / patch their shadow DOM here. Must not touch attributes. */
  protected abstract render(): void;

  /**
   * Schedule exactly one render for the current microtask checkpoint.
   * Safe to call any number of times per task.
   */
  protected invalidate(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  /** Dispatch a composed, bubbling custom event. */
  protected emit(type: string): void;
  protected emit<T>(type: string, detail: T): void;
  protected emit<T>(type: string, detail?: T): void {
    this.dispatchEvent(
      new CustomEvent<T>(type, {
        detail: detail as T,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Replace the shadow root's element children while preserving the fallback
   * `<style>` node some engines need (constructable stylesheet support absent).
   */
  protected replaceContent(...nodes: Node[]): void {
    const fallbackStyles = Array.from(this.root.querySelectorAll("style"));
    this.root.replaceChildren(...fallbackStyles, ...nodes);
  }

  /** Read an attribute with a fallback, trimming whitespace. */
  protected attr(name: string): string | null {
    const value = this.getAttribute(name);
    return value === null ? null : value.trim();
  }

  /** Read a numeric attribute, falling back when absent or malformed. */
  protected attrNumber(name: string, fallback: number): number {
    const raw = this.attr(name);
    if (raw === null || raw === "") return fallback;
    return toFinite(Number(raw), fallback);
  }

  /** Presence-based boolean attribute. */
  protected attrBool(name: string): boolean {
    return this.hasAttribute(name);
  }

  private applyStyles(): void {
    const ctor = this.constructor as unknown as ElementClass;
    let entry = STYLE_CACHE.get(ctor);
    if (!entry) {
      const text = `${BASE_STYLES}\n${ctor.styles ?? ""}`;
      entry = { text, sheet: createSheet(text) };
      STYLE_CACHE.set(ctor, entry);
    }

    if (entry.sheet) {
      try {
        this.root.adoptedStyleSheets = [entry.sheet];
        return;
      } catch {
        // Fall through to the <style> fallback below.
      }
    }

    const style = document.createElement("style");
    style.textContent = entry.text;
    this.root.append(style);
  }
}

function createSheet(text: string): CSSStyleSheet | null {
  if (!supportsConstructableSheets()) return null;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return sheet;
  } catch {
    return null;
  }
}
