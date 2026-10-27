/**
 * `<cz-cover src seed size>` - album art with a deterministic fallback.
 *
 * When `src` is empty (or fails to load) the element paints a gradient derived
 * from `hash(seed)`, using one of twelve curated palettes, plus a small musical
 * note glyph. The same seed always produces the same artwork, so a library with
 * missing covers still looks intentional.
 *
 * Properties
 *  - `src`   image URL / data URL, or null/"" for the generated artwork
 *  - `seed`  any stable string (track id, album name, ...)
 *  - `size`  edge length in CSS pixels (default 56)
 */

import { CzElement } from "../base.js";
import { iconSvg } from "../icons.js";

/** Twelve curated two-hue palettes; picked deterministically from the seed. */
const PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#7c3aed", "#22d3ee"],
  ["#db2777", "#f59e0b"],
  ["#2563eb", "#8b5cf6"],
  ["#059669", "#84cc16"],
  ["#ea580c", "#dc2626"],
  ["#0ea5e9", "#14b8a6"],
  ["#a855f7", "#ec4899"],
  ["#f43f5e", "#fb923c"],
  ["#6366f1", "#06b6d4"],
  ["#16a34a", "#0d9488"],
  ["#b45309", "#d97706"],
  ["#334155", "#64748b"],
];

/** FNV-1a, 32 bit. Deterministic across runs and platforms. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function paletteFor(seed: string): { angle: number; colors: readonly [string, string] } {
  const hash = hashSeed(seed || "cadenza");
  const palette = PALETTES[hash % PALETTES.length] ?? PALETTES[0] ?? ["#7c3aed", "#22d3ee"];
  const angle = 105 + (Math.floor(hash / PALETTES.length) % 61);
  return { angle, colors: palette };
}

export class CzCover extends CzElement {
  static override styles = `
    :host {
      display: inline-block;
      position: relative;
      flex: none;
      overflow: hidden;
      background: var(--cz-surface-2, #1b1f29);
      box-shadow: var(--cz-shadow-1, 0 1px 2px rgba(0, 0, 0, 0.4));
      vertical-align: middle;
      isolation: isolate;
    }
    .art {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .fallback {
      position: relative;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    }
    .fallback::after {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(120% 90% at 78% 108%, rgba(0, 0, 0, 0.34), transparent 62%);
      pointer-events: none;
    }
    .note {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.88);
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
      z-index: 1;
    }
    .note svg {
      stroke-width: 1.6;
    }
  `;

  static override get observedAttributes(): string[] {
    return ["src", "seed", "size"];
  }

  private source: string | null = null;
  private seedValue = "cadenza";
  private coverSize = 56;
  private failedSource: string | null = null;
  private img: HTMLImageElement | null = null;

  get src(): string | null {
    return this.source;
  }

  set src(value: string | null) {
    const next = typeof value === "string" && value.length > 0 ? value : null;
    if (next !== this.source) this.failedSource = null;
    this.source = next;
    this.invalidate();
  }

  get seed(): string {
    return this.seedValue;
  }

  set seed(value: string) {
    this.seedValue = String(value ?? "");
    this.invalidate();
  }

  get size(): number {
    return this.coverSize;
  }

  set size(value: number) {
    const next = Number(value);
    this.coverSize = Number.isFinite(next) ? Math.min(1024, Math.max(16, Math.round(next))) : 56;
    this.invalidate();
  }

  override attributeChangedCallback(attributeName: string, _oldValue: string | null, newValue: string | null): void {
    switch (attributeName) {
      case "src":
        this.src = newValue;
        break;
      case "seed":
        this.seed = newValue ?? "";
        break;
      case "size":
        this.size = newValue === null ? 56 : Number(newValue);
        break;
      default:
        break;
    }
  }

  protected override render(): void {
    const size = this.coverSize;
    this.style.width = `${size}px`;
    this.style.height = `${size}px`;
    this.style.borderRadius = `${Math.max(8, Math.round(size * 0.16))}px`;
    this.setAttribute("aria-hidden", "true");

    const usableSource = this.source !== null && this.source !== this.failedSource ? this.source : null;

    if (usableSource) {
      if (!this.img) {
        const img = document.createElement("img");
        img.className = "art";
        img.alt = "";
        img.setAttribute("role", "presentation");
        img.setAttribute("draggable", "false");
        img.decoding = "async";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => {
          if (this.source) {
            this.failedSource = this.source;
            this.invalidate();
          }
        });
        this.img = img;
      }
      if (this.img.getAttribute("src") !== usableSource) this.img.setAttribute("src", usableSource);
      if (this.img.parentNode !== this.root) this.replaceContent(this.img);
      return;
    }

    const fallback = document.createElement("div");
    fallback.className = "art fallback";
    const { angle, colors } = paletteFor(this.seedValue);
    const [first = "#7c3aed", second = "#22d3ee"] = colors;
    fallback.style.backgroundImage = `radial-gradient(circle at 30% 16%, rgba(255,255,255,0.24), transparent 58%), linear-gradient(${angle}deg, ${first}, ${second})`;
    fallback.dataset.fallback = "true";

    const note = document.createElement("span");
    note.className = "note";
    note.append(iconSvg("music", Math.max(14, Math.round(size * 0.34))));
    fallback.append(note);

    this.replaceContent(fallback);
  }
}
