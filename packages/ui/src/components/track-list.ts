/**
 * `<cz-track-list>` -the library table and the queue list.
 *
 * Properties
 *  - `tracks`     `Track[]` (identity change triggers a rebuild)
 *  - `currentId`  id of the playing track, or null
 *  - `playing`    whether playback is running (drives the equalizer)
 *  - `variant`    "full" (library) or "compact" (40px queue rows)
 *  - `emptyText`  shown when `tracks` is empty
 *  - `showHeader` render the # / Title / Artist / Album / Duration header (full)
 *
 * Events
 *  - `cz-activate` `{ track, index }` -click, double click, Enter or Space
 *  - `cz-menu`     `{ track, index, x, y }` -right click
 *  - `cz-reorder`  `{ from, to }` -HTML5 drag and drop
 *
 * The list caps at 400 rendered rows; the rest are appended in 400-row chunks
 * from a "show more" button so huge libraries never block the renderer.
 */

import { CzElement, type Track } from "../base.js";
import { iconSvg } from "../icons.js";

const PAGE_SIZE = 400;

type Variant = "full" | "compact";

interface ActivateDetail {
  track: Track;
  index: number;
}

interface MenuDetail {
  track: Track;
  index: number;
  x: number;
  y: number;
}

interface ReorderDetail {
  from: number;
  to: number;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function cell(className: string, text: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

export class CzTrackList extends CzElement {
  static override styles = `
    :host {
      display: block;
      min-width: 0;
      color: var(--cz-text, #eef1f8);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 6px 8px;
    }
    .header-row {
      display: grid;
      grid-template-columns: 40px minmax(0, 2.4fr) minmax(0, 1.8fr) minmax(0, 1.8fr) 72px;
      gap: 12px;
      align-items: center;
      padding: 0 10px 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--cz-text-mute, #6b7488);
    }
    .row {
      position: relative;
      display: grid;
      grid-template-columns: 40px minmax(0, 2.4fr) minmax(0, 1.8fr) minmax(0, 1.8fr) 72px;
      gap: 12px;
      align-items: center;
      min-height: 48px;
      padding: 0 10px;
      border-radius: var(--cz-radius-sm, 10px);
      cursor: default;
      transition: background 150ms cubic-bezier(0.2, 0, 0, 1);
    }
    .row:hover {
      background: color-mix(in srgb, var(--cz-text, #eef1f8) 6%, transparent);
    }
    .row.current {
      background: var(--cz-accent-soft, rgba(139, 92, 246, 0.16));
    }
    .row:focus-visible {
      outline: 2px solid var(--cz-accent, #8b5cf6);
      outline-offset: -2px;
    }
    .row.dragging {
      opacity: 0.45;
    }
    .row.drop-target {
      outline: 1px dashed var(--cz-accent, #8b5cf6);
      outline-offset: -2px;
    }
    .col {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .title {
      font-size: 13.5px;
      font-weight: 560;
      color: var(--cz-text, #eef1f8);
    }
    .row.current .title {
      color: var(--cz-text, #eef1f8);
    }
    .artist,
    .album {
      font-size: 12.5px;
      color: var(--cz-text-dim, #9aa4bb);
    }
    .duration {
      font-family: var(--cz-mono, "Cascadia Code", monospace);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: var(--cz-text-mute, #6b7488);
      text-align: right;
    }
    .index {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 20px;
      font-family: var(--cz-mono, "Cascadia Code", monospace);
      font-size: 12px;
      color: var(--cz-text-mute, #6b7488);
    }
    .row.current .index {
      color: var(--cz-accent, #8b5cf6);
    }
    .eq {
      display: none;
      align-items: flex-end;
      gap: 2px;
      height: 14px;
    }
    .row.current.playing .eq {
      display: inline-flex;
    }
    .row.current.playing .num {
      display: none;
    }
    .eq i {
      display: block;
      width: 2.5px;
      height: 100%;
      border-radius: 1px;
      background: var(--cz-grad, linear-gradient(135deg, #8b5cf6, #22d3ee));
      transform-origin: bottom;
      animation: cz-eq 900ms ease-in-out infinite;
    }
    .eq i:nth-child(2) {
      animation-delay: -300ms;
    }
    .eq i:nth-child(3) {
      animation-delay: -600ms;
    }
    @keyframes cz-eq {
      0%,
      100% {
        transform: scaleY(0.25);
      }
      50% {
        transform: scaleY(1);
      }
    }
    /* compact queue rows */
    .list.compact {
      padding: 4px 6px;
    }
    .row.compact {
      grid-template-columns: 16px 24px minmax(0, 1fr) 52px;
      gap: 8px;
      min-height: 40px;
      padding: 0 8px;
      border-radius: 8px;
    }
    .row.compact .handle {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--cz-text-mute, #6b7488);
      opacity: 0;
      cursor: grab;
      transition: opacity 150ms ease;
    }
    .row.compact:hover .handle,
    .row.compact:focus-visible .handle {
      opacity: 0.8;
    }
    .text {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
      min-width: 0;
    }
    .text .t {
      font-size: 13px;
      font-weight: 520;
      color: var(--cz-text, #eef1f8);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .text .a {
      font-size: 11px;
      color: var(--cz-text-dim, #9aa4bb);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .empty {
      padding: 36px 16px;
      text-align: center;
      font-size: 13px;
      color: var(--cz-text-mute, #6b7488);
    }
    .more {
      align-self: center;
      margin: 10px auto 8px;
      padding: 7px 16px;
      border: 1px solid var(--cz-border-strong, rgba(255, 255, 255, 0.14));
      border-radius: var(--cz-radius-pill, 999px);
      background: transparent;
      color: var(--cz-text-dim, #9aa4bb);
      font-size: 12px;
      font-weight: 550;
      transition:
        background 150ms ease,
        color 150ms ease,
        border-color 150ms ease;
    }
    .more:hover {
      background: var(--cz-surface-2, #1b1f29);
      color: var(--cz-text, #eef1f8);
    }
  `;

  static override get observedAttributes(): string[] {
    return ["current-id", "playing", "variant", "empty-text", "show-header"];
  }

  private trackData: readonly Track[] = [];
  private currentIdValue: string | null = null;
  private playingValue = false;
  private variantValue: Variant = "full";
  private emptyTextValue = "No tracks yet";
  private showHeaderValue = true;

  private listEl: HTMLElement | null = null;
  private moreButton: HTMLButtonElement | null = null;
  private rowEls: HTMLElement[] = [];
  private selectedIndex = -1;

  private renderedTracks: readonly Track[] | null = null;
  private renderedVariant: Variant | null = null;
  private renderedHeader: boolean | null = null;
  private renderedEmptyText: string | null = null;
  private syncedCurrentId: string | null | undefined = undefined;

  private dragFrom = -1;
  private lastActivateIndex = -1;
  private lastActivateAt = 0;

  get tracks(): readonly Track[] {
    return this.trackData;
  }

  set tracks(value: readonly Track[]) {
    this.trackData = Array.isArray(value) ? value : [];
    this.invalidate();
  }

  get currentId(): string | null {
    return this.currentIdValue;
  }

  set currentId(value: string | null) {
    this.currentIdValue = value ?? null;
    this.invalidate();
  }

  get playing(): boolean {
    return this.playingValue;
  }

  set playing(value: boolean) {
    this.playingValue = Boolean(value);
    this.invalidate();
  }

  get variant(): Variant {
    return this.variantValue;
  }

  set variant(value: Variant) {
    this.variantValue = value === "compact" ? "compact" : "full";
    this.invalidate();
  }

  get emptyText(): string {
    return this.emptyTextValue;
  }

  set emptyText(value: string) {
    this.emptyTextValue = value || "No tracks yet";
    this.invalidate();
  }

  get showHeader(): boolean {
    return this.showHeaderValue;
  }

  set showHeader(value: boolean) {
    this.showHeaderValue = Boolean(value);
    this.invalidate();
  }

  override attributeChangedCallback(attributeName: string, _oldValue: string | null, newValue: string | null): void {
    switch (attributeName) {
      case "current-id":
        this.currentId = newValue;
        break;
      case "playing":
        this.playing = newValue !== null;
        break;
      case "variant":
        this.variant = newValue === "compact" ? "compact" : "full";
        break;
      case "empty-text":
        this.emptyText = newValue ?? "";
        break;
      case "show-header":
        this.showHeader = newValue === null ? false : newValue !== "false";
        break;
      default:
        break;
    }
  }

  protected override render(): void {
    const headerVisible = this.showHeaderValue && this.variantValue === "full";
    const rebuild =
      this.renderedTracks !== this.trackData ||
      this.renderedVariant !== this.variantValue ||
      this.renderedHeader !== headerVisible ||
      this.renderedEmptyText !== this.emptyTextValue;

    if (rebuild) this.buildList(headerVisible);
    this.updateRows();
  }

  /* ------------------------------------------------------------------ build */

  private buildList(headerVisible: boolean): void {
    const list = document.createElement("div");
    list.className = this.variantValue === "compact" ? "list compact" : "list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", this.variantValue === "compact" ? "Queue" : "Tracks");

    if (headerVisible) {
      const header = document.createElement("div");
      header.className = "header-row";
      header.setAttribute("aria-hidden", "true");
      header.append(cell("col", "#"), cell("col", "Title"), cell("col", "Artist"), cell("col", "Album"), cell("duration", "Duration"));
      list.append(header);
    }

    this.rowEls = [];
    this.moreButton = null;
    this.selectedIndex = -1;
    this.syncedCurrentId = undefined;

    if (this.trackData.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = this.emptyTextValue;
      list.append(empty);
    } else {
      const firstEnd = Math.min(PAGE_SIZE, this.trackData.length);
      for (let index = 0; index < firstEnd; index += 1) {
        const row = this.createRow(index);
        this.rowEls.push(row);
        list.append(row);
      }
      if (this.trackData.length > PAGE_SIZE) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "more";
        more.textContent = `Show ${this.trackData.length - firstEnd} more tracks`;
        more.addEventListener("click", () => this.appendNextPage());
        this.moreButton = more;
        list.append(more);
      }
    }

    this.listEl = list;
    this.renderedTracks = this.trackData;
    this.renderedVariant = this.variantValue;
    this.renderedHeader = headerVisible;
    this.renderedEmptyText = this.emptyTextValue;
    this.replaceContent(list);
  }

  private createRow(index: number): HTMLElement {
    const track = this.trackData[index];
    const row = document.createElement("div");
    row.className = this.variantValue === "compact" ? "row compact" : "row";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    row.tabIndex = 0;
    row.draggable = true;
    row.dataset.index = String(index);

    if (this.variantValue === "full") {
      const idx = document.createElement("span");
      idx.className = "col index";
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(index + 1);
      const eq = document.createElement("span");
      eq.className = "eq";
      eq.setAttribute("aria-hidden", "true");
      eq.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
      idx.append(num, eq);

      row.append(
        idx,
        cell("col title", track?.title || "Unknown title"),
        cell("col artist", track?.artist || "Unknown artist"),
        cell("col album", track?.album || "-"),
        cell("col duration", formatDuration(track?.duration ?? 0)),
      );
    } else {
      const handle = document.createElement("span");
      handle.className = "handle";
      handle.setAttribute("aria-hidden", "true");
      handle.append(iconSvg("drag", 14));

      const idx = cell("col index", String(index + 1));

      const text = document.createElement("span");
      text.className = "col text";
      const title = document.createElement("span");
      title.className = "t";
      title.textContent = track?.title || "Unknown title";
      const artist = document.createElement("span");
      artist.className = "a";
      artist.textContent = track?.artist || "Unknown artist";
      text.append(title, artist);

      row.append(handle, idx, text, cell("col duration", formatDuration(track?.duration ?? 0)));
    }

    this.bindRow(row, index);
    return row;
  }

  private bindRow(row: HTMLElement, index: number): void {
    // A click selects; it also activates (the spec's "clicking a row dispatches
    // cz-activate"). Double click is de-duplicated so it never fires twice.
    row.addEventListener("click", () => {
      this.selectedIndex = index;
      this.updateRows();
      this.activate(index);
    });

    row.addEventListener("dblclick", () => {
      this.activate(index);
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const track = this.trackData[index];
      if (!track) return;
      const mouse = event as MouseEvent;
      this.emit<MenuDetail>("cz-menu", { track, index, x: mouse.clientX, y: mouse.clientY });
    });

    row.addEventListener("keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " " || key === "Spacebar") {
        event.preventDefault();
        this.activate(index);
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        const nextIndex = key === "ArrowDown" ? index + 1 : index - 1;
        const target = this.rowEls[nextIndex];
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
    });

    row.addEventListener("dragstart", (event) => {
      this.dragFrom = index;
      row.classList.add("dragging");
      const dataTransfer = (event as DragEvent).dataTransfer;
      if (dataTransfer) {
        dataTransfer.effectAllowed = "move";
        try {
          dataTransfer.setData("text/plain", String(index));
        } catch {
          // some engines reject custom payloads; the index is also in memory
        }
      }
    });

    row.addEventListener("dragover", (event) => {
      if (this.dragFrom < 0) return;
      event.preventDefault();
      row.classList.add("drop-target");
      const dataTransfer = (event as DragEvent).dataTransfer;
      if (dataTransfer) dataTransfer.dropEffect = "move";
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drop-target");
    });

    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("drop-target");
      const from = this.dragFrom;
      this.clearDragState();
      if (from >= 0 && from !== index) {
        this.emit<ReorderDetail>("cz-reorder", { from, to: index });
      }
    });

    row.addEventListener("dragend", () => {
      this.clearDragState();
    });
  }

  /* ------------------------------------------------------------------- state */

  private activate(index: number): void {
    const track = this.trackData[index];
    if (!track) return;
    const now = Date.now();
    if (index === this.lastActivateIndex && now - this.lastActivateAt < 350) return;
    this.lastActivateIndex = index;
    this.lastActivateAt = now;
    this.emit<ActivateDetail>("cz-activate", { track, index });
  }

  private appendNextPage(): void {
    if (!this.listEl) return;
    const start = this.rowEls.length;
    const end = Math.min(start + PAGE_SIZE, this.trackData.length);
    for (let index = start; index < end; index += 1) {
      const row = this.createRow(index);
      this.rowEls.push(row);
      if (this.moreButton && this.moreButton.parentNode === this.listEl) {
        this.listEl.insertBefore(row, this.moreButton);
      } else {
        this.listEl.append(row);
      }
    }
    if (end >= this.trackData.length) {
      this.moreButton?.remove();
      this.moreButton = null;
    } else if (this.moreButton) {
      this.moreButton.textContent = `Show ${this.trackData.length - end} more tracks`;
    }
    this.updateRows();
  }

  private clearDragState(): void {
    this.dragFrom = -1;
    for (const row of this.rowEls) row.classList.remove("dragging", "drop-target");
  }

  private updateRows(): void {
    if (this.currentIdValue !== this.syncedCurrentId) {
      this.syncedCurrentId = this.currentIdValue;
      const current = this.currentIdValue;
      if (current === null) {
        this.selectedIndex = -1;
      } else {
        const index = this.trackData.findIndex((track) => track.id === current);
        this.selectedIndex = index;
      }
    }

    for (let index = 0; index < this.rowEls.length; index += 1) {
      const row = this.rowEls[index];
      if (!row) continue;
      const track = this.trackData[index];
      const isCurrent = track !== undefined && this.currentIdValue !== null && track.id === this.currentIdValue;
      row.classList.toggle("current", isCurrent);
      row.classList.toggle("playing", isCurrent && this.playingValue);
      row.setAttribute("aria-selected", index === this.selectedIndex ? "true" : "false");
      const num = row.querySelector(".num");
      if (num) num.textContent = String(index + 1);
    }
  }
}



