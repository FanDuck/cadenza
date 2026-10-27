/**
 * `<cz-slider>` -the kit's only draggable control: progress, volume, anything
 * numeric. It is a proper ARIA slider and supports pointer, click-to-seek and
 * keyboard input.
 *
 * Properties
 *  - `value`    current value, clamped into [min, max] and snapped to `step`
 *  - `min`      default 0
 *  - `max`      default 1
 *  - `step`     default 0.01
 *  - `buffered` 0..1 fraction of the range drawn behind the fill
 *  - `disabled`
 *  - `label`    accessible name (aria-label)
 *  - `formatValue` optional `(value) => string` for the tooltip / aria-valuetext
 *
 * Events
 *  - `cz-input`  `{ value }` continuously while dragging / on each key press
 *  - `cz-change` `{ value }` on pointer release and keyboard commit
 */

import { CzElement } from "../base.js";

export interface SliderChangeDetail {
  value: number;
}

const DEFAULT_LABEL = "Slider";

export class CzSlider extends CzElement {
  static override styles = `
    :host {
      display: inline-flex;
      align-items: center;
      position: relative;
      width: 100%;
      height: 22px;
      cursor: pointer;
      touch-action: none;
      outline: none;
      -webkit-user-select: none;
      user-select: none;
    }
    :host(:focus-visible) {
      outline: 2px solid var(--cz-accent, #8b5cf6);
      outline-offset: 4px;
      border-radius: var(--cz-radius-pill, 999px);
    }
    :host([disabled]) {
      opacity: 0.45;
      cursor: default;
      pointer-events: none;
    }
    .rail {
      position: relative;
      flex: 1;
      height: 4px;
      border-radius: var(--cz-radius-pill, 999px);
    }
    .track {
      position: absolute;
      inset: 0;
      overflow: hidden;
      border-radius: inherit;
      background: var(--cz-surface-3, #232834);
    }
    .buffered {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 0;
      background: var(--cz-border-strong, rgba(255, 255, 255, 0.14));
      transition: width 150ms cubic-bezier(0.2, 0, 0, 1);
    }
    .fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 0;
      border-radius: inherit;
      background: var(--cz-grad, linear-gradient(135deg, #8b5cf6, #22d3ee));
      transition: width 150ms cubic-bezier(0.2, 0, 0, 1);
    }
    .thumb {
      position: absolute;
      top: 50%;
      left: 0;
      width: 12px;
      height: 12px;
      margin: -6px 0 0 -6px;
      border-radius: 50%;
      background: var(--cz-text, #eef1f8);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.45);
      transition:
        transform 150ms cubic-bezier(0.2, 0, 0, 1),
        background 150ms ease,
        box-shadow 150ms ease;
      will-change: left;
    }
    :host(:hover) .thumb,
    :host([data-dragging]) .thumb {
      transform: scale(1.28);
      background: #ffffff;
      box-shadow: 0 0 0 4px var(--cz-accent-soft, rgba(139, 92, 246, 0.16)), 0 2px 8px rgba(0, 0, 0, 0.45);
    }
    :host([data-dragging]) .fill,
    :host([data-dragging]) .buffered {
      transition: none;
    }
    .tip {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 0;
      transform: translateX(-50%);
      padding: 3px 7px;
      border: 1px solid var(--cz-border, rgba(255, 255, 255, 0.08));
      border-radius: 6px;
      background: var(--cz-surface-2, #1b1f29);
      color: var(--cz-text, #eef1f8);
      font-family: var(--cz-font, "Segoe UI", system-ui, sans-serif);
      font-size: 11px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: var(--cz-shadow-1, 0 1px 2px rgba(0, 0, 0, 0.4));
      z-index: 2;
    }
  `;

  static override get observedAttributes(): string[] {
    return ["value", "max", "min", "step", "buffered", "disabled", "label"];
  }

  private currentValue = 0;
  private currentMin = 0;
  private currentMax = 1;
  private currentStep = 0.01;
  private currentBuffered = 0;
  private isDisabled = false;
  private labelText = DEFAULT_LABEL;
  private formatter: ((value: number) => string) | null = null;

  private rail: HTMLElement | null = null;
  private bufferedBar: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private thumb: HTMLElement | null = null;
  private tip: HTMLElement | null = null;

  private dragging = false;
  private hovering = false;
  private capturedPointer: number | null = null;

  constructor() {
    super();
    // NOTE: no attributes may be written inside a custom element constructor
    // (synchronous construction throws NotSupportedError). ARIA wiring happens
    // in render(), which runs on a microtask after construction.
    this.addEventListener("pointerdown", this.onPointerDown);
    this.addEventListener("pointermove", this.onPointerMove);
    this.addEventListener("pointerup", this.onPointerUp);
    this.addEventListener("pointercancel", this.onPointerUp);
    this.addEventListener("keydown", this.onKeyDown);
    this.addEventListener("mouseenter", this.onMouseEnter);
    this.addEventListener("mouseleave", this.onMouseLeave);
  }

  get value(): number {
    return this.currentValue;
  }

  set value(value: number) {
    this.currentValue = this.snapValue(value);
    this.invalidate();
  }

  get min(): number {
    return this.currentMin;
  }

  set min(value: number) {
    const next = Number(value);
    this.currentMin = Number.isFinite(next) ? next : 0;
    if (this.currentMax < this.currentMin) this.currentMax = this.currentMin;
    this.currentValue = this.snapValue(this.currentValue);
    this.invalidate();
  }

  get max(): number {
    return this.currentMax;
  }

  set max(value: number) {
    const next = Number(value);
    this.currentMax = Number.isFinite(next) ? next : 1;
    if (this.currentMax < this.currentMin) this.currentMin = this.currentMax;
    this.currentValue = this.snapValue(this.currentValue);
    this.invalidate();
  }

  get step(): number {
    return this.currentStep;
  }

  set step(value: number) {
    const next = Number(value);
    this.currentStep = Number.isFinite(next) && next > 0 ? next : 0.01;
    this.currentValue = this.snapValue(this.currentValue);
    this.invalidate();
  }

  /** Buffered fraction of the range, `0..1`. */
  get buffered(): number {
    return this.currentBuffered;
  }

  set buffered(value: number) {
    const next = Number(value);
    this.currentBuffered = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0;
    this.invalidate();
  }

  get disabled(): boolean {
    return this.isDisabled;
  }

  set disabled(value: boolean) {
    const next = Boolean(value);
    if (next === this.isDisabled) return;
    this.isDisabled = next;
    this.toggleAttribute("disabled", next);
    this.invalidate();
  }

  get label(): string {
    return this.labelText;
  }

  set label(value: string) {
    this.labelText = value || DEFAULT_LABEL;
    this.invalidate();
  }

  /** True while the user is actively dragging the thumb. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Optional formatter for the hover tooltip and `aria-valuetext`. */
  get formatValue(): ((value: number) => string) | null {
    return this.formatter;
  }

  set formatValue(value: ((value: number) => string) | null) {
    this.formatter = typeof value === "function" ? value : null;
    this.invalidate();
  }

  override attributeChangedCallback(attributeName: string, _oldValue: string | null, newValue: string | null): void {
    switch (attributeName) {
      case "value":
        this.value = newValue === null ? this.currentMin : Number(newValue);
        break;
      case "min":
        this.min = newValue === null ? 0 : Number(newValue);
        break;
      case "max":
        this.max = newValue === null ? 1 : Number(newValue);
        break;
      case "step":
        this.step = newValue === null ? 0.01 : Number(newValue);
        break;
      case "buffered":
        this.buffered = newValue === null ? 0 : Number(newValue);
        break;
      case "disabled":
        this.disabled = newValue !== null;
        break;
      case "label":
        this.label = newValue ?? DEFAULT_LABEL;
        break;
      default:
        break;
    }
  }

  protected override render(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "slider");
    if (this.tabIndex !== 0) this.tabIndex = 0;
    if (!this.rail) {
      const rail = document.createElement("div");
      rail.className = "rail";

      const track = document.createElement("div");
      track.className = "track";

      const bufferedBar = document.createElement("div");
      bufferedBar.className = "buffered";

      const fill = document.createElement("div");
      fill.className = "fill";

      track.append(bufferedBar, fill);

      const thumb = document.createElement("div");
      thumb.className = "thumb";

      rail.append(track, thumb);

      const tip = document.createElement("div");
      tip.className = "tip";
      tip.hidden = true;

      this.rail = rail;
      this.bufferedBar = bufferedBar;
      this.fill = fill;
      this.thumb = thumb;
      this.tip = tip;

      this.replaceContent(rail, tip);
    }
    this.paint();
  }

  /* ---------------------------------------------------------------- geometry */

  private range(): number {
    return this.currentMax - this.currentMin;
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) return this.currentMin;
    return Math.min(this.currentMax, Math.max(this.currentMin, value));
  }

  private snapValue(value: number): number {
    const step = this.currentStep > 0 ? this.currentStep : 0.01;
    const clamped = this.clamp(value);
    const snapped = this.currentMin + Math.round((clamped - this.currentMin) / step) * step;
    return Number(this.clamp(snapped).toFixed(6));
  }

  private ratio(): number {
    const range = this.range();
    if (range <= 0) return 0;
    return Math.min(1, Math.max(0, (this.currentValue - this.currentMin) / range));
  }

  private valueFromClientX(clientX: number): number {
    const rect = this.getBoundingClientRect();
    const width = rect.width || this.clientWidth || 1;
    if (!Number.isFinite(clientX) || width <= 0) return this.currentValue;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / width));
    return this.snapValue(this.currentMin + ratio * this.range());
  }

  /* ------------------------------------------------------------------ painting */

  private format(value: number): string {
    if (this.formatter) return this.formatter(value);
    if (this.currentMin === 0 && this.currentMax <= 1) {
      return `${Math.round(value * 100)}%`;
    }
    const decimals = this.currentStep < 0.1 ? 1 : 0;
    return value.toFixed(decimals);
  }

  private paint(): void {
    if (!this.fill || !this.bufferedBar || !this.thumb) return;
    const percent = this.ratio() * 100;
    this.fill.style.width = `${percent}%`;
    this.bufferedBar.style.width = `${this.currentBuffered * 100}%`;
    this.thumb.style.left = `${percent}%`;

    const text = this.format(this.currentValue);
    this.setAttribute("aria-valuemin", String(this.currentMin));
    this.setAttribute("aria-valuemax", String(this.currentMax));
    this.setAttribute("aria-valuenow", String(Math.round(this.currentValue * 100) / 100));
    this.setAttribute("aria-valuetext", text);
    this.setAttribute("aria-label", this.labelText);
    if (this.isDisabled) this.setAttribute("aria-disabled", "true");
    else this.removeAttribute("aria-disabled");

    if (this.tip) {
      this.tip.textContent = text;
      this.tip.style.left = `${percent}%`;
    }
  }

  private showTip(show: boolean): void {
    if (!this.tip) return;
    this.tip.hidden = !show || this.isDisabled;
  }

  /* ------------------------------------------------------------------ pointer */

  private beginDrag(event: Event): void {
    if (this.isDisabled) return;
    const pointer = event as PointerEvent;
    event.preventDefault();
    this.dragging = true;
    this.setAttribute("data-dragging", "");
    this.focus();
    const value = this.valueFromClientX(pointer.clientX);
    this.commit(value, "input");
    const pointerId = pointer.pointerId;
    if (typeof pointerId === "number" && typeof this.setPointerCapture === "function") {
      try {
        this.setPointerCapture(pointerId);
        this.capturedPointer = pointerId;
      } catch {
        this.capturedPointer = null;
      }
    }
  }

  private readonly onPointerDown = (event: Event): void => {
    this.beginDrag(event);
    if (this.dragging) this.showTip(true);
  };

  private readonly onPointerMove = (event: Event): void => {
    if (this.dragging) {
      this.commit(this.valueFromClientX((event as PointerEvent).clientX), "input");
    }
  };

  private readonly onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.removeAttribute("data-dragging");
    if (this.capturedPointer !== null && typeof this.releasePointerCapture === "function") {
      try {
        this.releasePointerCapture(this.capturedPointer);
      } catch {
        // ignore; capture may already be gone
      }
    }
    this.capturedPointer = null;
    this.paint();
    this.showTip(this.hovering);
    this.emit<SliderChangeDetail>("cz-change", { value: this.currentValue });
  };

  private readonly onMouseEnter = (): void => {
    this.hovering = true;
    this.showTip(true);
  };

  private readonly onMouseLeave = (): void => {
    this.hovering = false;
    if (!this.dragging) this.showTip(false);
  };

  /* ----------------------------------------------------------------- keyboard */

  private readonly onKeyDown = (event: Event): void => {
    if (this.isDisabled) return;
    const key = (event as KeyboardEvent).key;
    const range = this.range();
    const step = this.currentStep;
    const jump = range * 0.05;
    let next: number | null = null;

    switch (key) {
      case "ArrowRight":
      case "ArrowUp":
        next = this.currentValue + ((event as KeyboardEvent).shiftKey ? jump : step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = this.currentValue - ((event as KeyboardEvent).shiftKey ? jump : step);
        break;
      case "PageUp":
        next = this.currentValue + jump;
        break;
      case "PageDown":
        next = this.currentValue - jump;
        break;
      case "Home":
        next = this.currentMin;
        break;
      case "End":
        next = this.currentMax;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.commit(next, "both");
    this.showTip(true);
  };

  /** Apply a user-driven value and emit the matching event(s). */
  private commit(raw: number, kind: "input" | "change" | "both"): void {
    const next = this.snapValue(raw);
    if (next === this.currentValue) {
      if (kind !== "input") {
        this.paint();
        this.emit<SliderChangeDetail>("cz-change", { value: next });
      }
      return;
    }
    this.currentValue = next;
    this.paint();
    if (kind === "input" || kind === "both") {
      this.emit<SliderChangeDetail>("cz-input", { value: next });
    }
    if (kind === "change" || kind === "both") {
      this.emit<SliderChangeDetail>("cz-change", { value: next });
    }
  }
}


