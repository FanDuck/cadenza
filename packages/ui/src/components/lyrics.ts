/**
 * `<cz-lyrics>` -synced lyrics panel.
 *
 * Properties
 *  - `doc`       `LyricsDoc | null`
 *  - `position`  playback position in seconds (updates ~4x/s; only the active
 *                line changes, the list is never rebuilt for a position tick)
 *  - `title`     optional heading (track title)
 *
 * Clicking a line (or Enter/Space on it) emits `cz-seek { seconds }`.
 * The active line is centred with a smooth scroll.
 */

import { CzElement, type LrcLine, type LyricsDoc } from "../base.js";
import { iconSvg } from "../icons.js";

interface SeekDetail {
  seconds: number;
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export class CzLyrics extends CzElement {
  static override styles = `
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      color: var(--cz-text, #eef1f8);
    }
    .wrap {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 0 18px 12px;
      flex: none;
    }
    .title {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 15px;
      font-weight: 600;
      color: var(--cz-text, #eef1f8);
    }
    .badge {
      flex: none;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cz-text-mute, #6b7488);
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 8px 10px 40% 10px;
      scroll-behavior: smooth;
      mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
      -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 0 6px;
    }
    .line-row {
      display: block;
    }
    .line {
      display: block;
      width: 100%;
      padding: 9px 12px;
      border-radius: var(--cz-radius-sm, 10px);
      text-align: left;
      font-size: 15px;
      line-height: 1.45;
      color: var(--cz-text-mute, #6b7488);
      transition:
        color 150ms ease,
        background 150ms ease,
        font-size 150ms ease;
    }
    .line:hover {
      color: var(--cz-text-dim, #9aa4bb);
      background: color-mix(in srgb, var(--cz-text, #eef1f8) 5%, transparent);
    }
    .line.active {
      color: var(--cz-accent, #8b5cf6);
      background: var(--cz-accent-soft, rgba(139, 92, 246, 0.16));
      font-size: 19px;
      font-weight: 600;
      text-shadow: 0 0 26px var(--cz-accent-soft, rgba(139, 92, 246, 0.16));
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 48px 24px;
      text-align: center;
    }
    .empty .glyph {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: var(--cz-surface-2, #1b1f29);
      border: 1px solid var(--cz-border, rgba(255, 255, 255, 0.08));
      color: var(--cz-text-mute, #6b7488);
      margin-bottom: 2px;
    }
    .empty-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--cz-text-dim, #9aa4bb);
    }
    .empty-desc {
      max-width: 340px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--cz-text-mute, #6b7488);
    }
  `;

  static override get observedAttributes(): string[] {
    return ["position", "title"];
  }

  private docValue: LyricsDoc | null = null;
  private positionValue = 0;
  private titleValue = "";

  private bodyEl: HTMLElement | null = null;
  private lineEls: HTMLElement[] = [];
  private activeIndex = -1;
  private renderedDoc: LyricsDoc | null | undefined = undefined;
  private renderedTitle: string | null = null;

  get doc(): LyricsDoc | null {
    return this.docValue;
  }

  set doc(value: LyricsDoc | null) {
    this.docValue = value ?? null;
    this.invalidate();
  }

  get position(): number {
    return this.positionValue;
  }

  set position(value: number) {
    this.positionValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    this.invalidate();
  }

  override get title(): string {
    return this.titleValue;
  }

  override set title(value: string) {
    this.titleValue = value || "";
    this.invalidate();
  }

  override attributeChangedCallback(attributeName: string, _oldValue: string | null, newValue: string | null): void {
    if (attributeName === "position") this.position = newValue === null ? 0 : Number(newValue);
    else if (attributeName === "title") this.title = newValue ?? "";
  }

  protected override render(): void {
    if (this.renderedDoc !== this.docValue || this.renderedTitle !== this.titleValue) {
      this.build();
    }
    this.updateActive();
  }

  /* ------------------------------------------------------------------ build */

  private build(): void {
    const wrap = document.createElement("div");
    wrap.className = "wrap";

    if (this.titleValue.length > 0) {
      const head = document.createElement("div");
      head.className = "head";
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = this.titleValue;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Synced";
      head.append(title, badge);
      wrap.append(head);
    }

    const body = document.createElement("div");
    body.className = "body";

    const doc = this.docValue;
    const lines = doc?.lines ?? [];
    this.lineEls = [];
    this.activeIndex = -1;

    if (lines.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      const glyph = document.createElement("span");
      glyph.className = "glyph";
      glyph.append(iconSvg("lyrics", 24));
      const title = document.createElement("div");
      title.className = "empty-title";
      title.textContent = "No lyrics for this track";
      const description = document.createElement("div");
      description.className = "empty-desc";
      description.textContent = "Add a matching .lrc file next to the audio file, or embed lyrics in the track's tags.";
      empty.append(glyph, title, description);
      body.append(empty);
    } else {
      const list = document.createElement("div");
      list.className = "list";
      list.setAttribute("role", "list");

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line) continue;
        list.append(this.createLine(line, index));
      }
      body.append(list);
    }

    wrap.append(body);
    this.bodyEl = body;
    this.renderedDoc = this.docValue;
    this.renderedTitle = this.titleValue;
    this.replaceContent(wrap);
  }

  private createLine(line: LrcLine, index: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "line-row";
    row.setAttribute("role", "listitem");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "line";
    button.textContent = line.text.length > 0 ? line.text : "-";
    const seconds = Math.max(0, this.effectiveTime(line));
    button.setAttribute("aria-label", `${button.textContent}, seek to ${formatTime(seconds)}`);
    button.addEventListener("click", () => {
      this.emit<SeekDetail>("cz-seek", { seconds: Math.max(0, this.effectiveTime(line)) });
    });

    this.lineEls[index] = button;
    row.append(button);
    return row;
  }

  private effectiveTime(line: LrcLine): number {
    return line.time + (this.docValue?.offset ?? 0);
  }

  /* ----------------------------------------------------------------- state */

  private findActiveIndex(): number {
    const doc = this.docValue;
    if (!doc || doc.lines.length === 0) return -1;
    let active = -1;
    const position = this.positionValue;
    for (let index = 0; index < doc.lines.length; index += 1) {
      const line = doc.lines[index];
      if (line && line.time + doc.offset <= position) active = index;
    }
    return active;
  }

  private updateActive(): void {
    const next = this.findActiveIndex();
    if (next === this.activeIndex) return;

    const previous = this.lineEls[this.activeIndex];
    if (previous) previous.classList.remove("active");

    this.activeIndex = next;
    const current = this.lineEls[next];
    if (!current) return;
    current.classList.add("active");

    const list = this.bodyEl;
    if (!list) return;
    const target = current.parentElement ?? current;
    const top = target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2;
    if (typeof list.scrollTo === "function") {
      try {
        list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        return;
      } catch {
        // fall through to direct assignment
      }
    }
    list.scrollTop = Math.max(0, top);
  }
}




