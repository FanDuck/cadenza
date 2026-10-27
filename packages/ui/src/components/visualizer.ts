/**
 * `<cz-visualizer>` -a canvas spectrum analyser.
 *
 * Properties
 *  - `analyser`  `AnalyserNode | null` (usually from a WebAudio graph)
 *  - `playing`   when false the bars fall into a slow, gentle idle wave
 *  - `bars`      number of bars (default 56, clamped 8..256)
 *  - `height`    CSS height in pixels (default 56)
 *
 * The animation loop only runs while the element is connected; it is cancelled
 * on disconnect. Bars are mirrored around the vertical centre with rounded caps
 * and a soft horizontal falloff, painted with the accent ->accent-2 gradient.
 * `devicePixelRatio` is respected for crisp rendering.
 */

import { CzElement } from "../base.js";

const MIN_BARS = 8;
const MAX_BARS = 256;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export class CzVisualizer extends CzElement {
  static override styles = `
    :host {
      display: block;
      min-width: 0;
      contain: content;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  static override get observedAttributes(): string[] {
    return ["bars", "height", "playing"];
  }

  private analyserNode: AnalyserNode | null = null;
  private playingValue = false;
  private barCount = 56;
  private canvasHeight = 56;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private frameId = 0;
  private frequencyData: Uint8Array<ArrayBuffer> | null = null;
  private levels: number[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private lastTimestamp = 0;

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  set analyser(value: AnalyserNode | null) {
    this.analyserNode = value;
    this.frequencyData = null;
    this.invalidate();
  }

  get playing(): boolean {
    return this.playingValue;
  }

  set playing(value: boolean) {
    this.playingValue = Boolean(value);
    this.invalidate();
  }

  get bars(): number {
    return this.barCount;
  }

  set bars(value: number) {
    this.barCount = Math.round(clampNumber(Number(value), MIN_BARS, MAX_BARS, 56));
    this.levels = [];
    this.invalidate();
  }

  get height(): number {
    return this.canvasHeight;
  }

  set height(value: number) {
    this.canvasHeight = Math.round(clampNumber(Number(value), 24, 480, 56));
    this.invalidate();
  }

  override attributeChangedCallback(attributeName: string, _oldValue: string | null, newValue: string | null): void {
    switch (attributeName) {
      case "bars":
        this.bars = newValue === null ? 56 : Number(newValue);
        break;
      case "height":
        this.height = newValue === null ? 56 : Number(newValue);
        break;
      case "playing":
        this.playing = newValue !== null;
        break;
      default:
        break;
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.start();
  }

  override disconnectedCallback(): void {
    this.stop();
  }

  protected override render(): void {
    if (!this.canvas) {
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      canvas.setAttribute("role", "presentation");
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.replaceContent(canvas);
      this.observeResize();
    }

    this.style.height = `${this.canvasHeight}px`;
    this.resizeCanvas();
    this.draw(performance.now());

    if (this.isConnected && this.frameId === 0) this.start();
  }

  private start(): void {
    if (this.frameId !== 0) return;
    if (typeof requestAnimationFrame !== "function") return;
    const loop = (timestamp: number): void => {
      this.frameId = requestAnimationFrame(loop);
      this.draw(timestamp);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.frameId !== 0 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frameId);
    }
    this.frameId = 0;
  }

  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      this.resizeCanvas();
      this.draw(performance.now());
    });
    observer.observe(this);
    this.resizeObserver = observer;
  }

  private resizeCanvas(): void {
    if (!this.canvas) return;
    const ratio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const width = Math.max(1, Math.round((this.clientWidth || 320) * ratio));
    const height = Math.max(1, Math.round(this.canvasHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /* ------------------------------------------------------------------ drawing */

  private computeLevels(timestamp: number): number[] {
    const count = this.barCount;
    if (this.levels.length !== count) this.levels = new Array<number>(count).fill(0.08);
    const levels = this.levels;
    const analyser = this.analyserNode;
    const active = this.playingValue && analyser !== null;

    if (active && analyser) {
      const bins = analyser.frequencyBinCount;
      if (!this.frequencyData || this.frequencyData.length !== bins) {
        this.frequencyData = new Uint8Array(new ArrayBuffer(bins));
      }
      try {
        analyser.getByteFrequencyData(this.frequencyData);
      } catch {
        return levels;
      }
      const data = this.frequencyData;
      for (let index = 0; index < count; index += 1) {
        // Sample the lower ~2/3 of the spectrum, where music actually lives.
        const position = index / Math.max(1, count - 1);
        const bin = Math.min(bins - 1, Math.floor(position * bins * 0.66));
        const value = (data[bin] ?? 0) / 255;
        const target = Math.min(1, value * 1.35);
        levels[index] = (levels[index] ?? 0) * 0.72 + target * 0.28;
      }
      return levels;
    }

    // Idle: a slow, breathing wave so the surface never looks dead.
    const time = timestamp / 1000;
    for (let index = 0; index < count; index += 1) {
      const wave = (Math.sin(time * 1.35 + index * 0.32) + 1) / 2;
      const target = 0.1 + wave * 0.14;
      levels[index] = (levels[index] ?? target) * 0.9 + target * 0.1;
    }
    return levels;
  }

  private draw(timestamp: number): void {
    if (!this.canvas || !this.ctx) return;
    // Throttle idle repaints so a paused player costs almost nothing.
    const elapsed = timestamp - this.lastTimestamp;
    if (!this.playingValue && elapsed < 32 && elapsed >= 0) return;
    this.lastTimestamp = timestamp;

    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width <= 1 || height <= 1) return;

    ctx.clearRect(0, 0, width, height);

    const levels = this.computeLevels(timestamp);
    const count = levels.length;
    const gap = Math.max(1, width / count / 4);
    const barWidth = Math.max(1, width / count - gap);
    const radius = barWidth / 2;
    const center = height / 2;

    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, getComputedStyleValue(this, "--cz-accent", "#8b5cf6"));
    gradient.addColorStop(1, getComputedStyleValue(this, "--cz-accent-2", "#22d3ee"));
    ctx.fillStyle = gradient;

    for (let index = 0; index < count; index += 1) {
      const position = index / Math.max(1, count - 1);
      const falloff = 0.55 + 0.45 * Math.sin(Math.PI * position);
      const level = (levels[index] ?? 0) * falloff;
      const barHeight = Math.max(barWidth * 0.6, level * height * 0.92);
      const x = index * (barWidth + gap);
      const y = center - barHeight / 2;
      drawRoundedBar(ctx, x, y, barWidth, barHeight, radius);
    }
  }
}

function drawRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
  ctx.fill();
}

/** Read a theme token from the element, with a hard fallback for detached trees. */
function getComputedStyleValue(element: Element, property: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  try {
    const value = getComputedStyle(element).getPropertyValue(property).trim();
    return value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

