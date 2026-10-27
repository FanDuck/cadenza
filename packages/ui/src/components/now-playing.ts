/**
 * `<cz-now-playing>` -the bottom transport bar.
 *
 * Layout: [cover + title/artist/album + heart] [prev - play/pause - next +
 * progress] [shuffle - repeat - mute/volume - queue]. Purely presentational:
 * it never owns playback state, it renders a `PlayerSnapshot` and emits intent
 * events for the host application to forward to the player.
 *
 * Properties
 *  - `snapshot`  `PlayerSnapshot | null`
 *  - `coverUrl`  resolved cover URL (data URL or app:// URL) or null
 *
 * Events (all `CustomEvent`, composed + bubbling)
 *  - `cz-toggle`           play / pause
 *  - `cz-next`, `cz-prev`
 *  - `cz-seek`             `{ seconds }`
 *  - `cz-volume`           `{ volume }` 0..1
 *  - `cz-mute`
 *  - `cz-shuffle`          `{ shuffle }` (requested next state)
 *  - `cz-repeat`           `{ repeat }` (requested next mode)
 *  - `cz-toggle-queue`
 *  - `cz-like`             `{ liked }` (heart; extension for hosts that store favourites)
 */

import { CzElement, type PlayerSnapshot, type RepeatMode } from "../base.js";
import { iconSvg, paintIcon } from "../icons.js";
import { CzCover } from "./cover.js";
import { CzSlider } from "./slider.js";

interface IconButton {
  button: HTMLButtonElement;
  svg: SVGSVGElement;
}

interface SliderValueDetail {
  value: number;
}

interface SeekDetail {
  seconds: number;
}

interface VolumeDetail {
  volume: number;
}

interface ShuffleDetail {
  shuffle: boolean;
}

interface RepeatDetail {
  repeat: RepeatMode;
}

interface LikeDetail {
  liked: boolean;
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.floor(safe);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function div(className: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

function span(className: string, text = ""): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

export class CzNowPlaying extends CzElement {
  static override styles = `
    :host {
      display: block;
      min-width: 0;
      color: var(--cz-text, #eef1f8);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 14px 18px;
      border: 1px solid var(--cz-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--cz-radius, 16px);
      background: color-mix(in srgb, var(--cz-surface, #14171f) 84%, transparent);
      box-shadow: var(--cz-shadow-2, 0 18px 40px rgba(0, 0, 0, 0.45));
      backdrop-filter: blur(18px) saturate(140%);
      -webkit-backdrop-filter: blur(18px) saturate(140%);
    }
    .left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      flex: 0 1 300px;
    }
    .cover-slot {
      display: flex;
      flex: none;
    }
    .meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .title,
    .artist,
    .album {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .title {
      font-size: 14px;
      font-weight: 600;
      color: var(--cz-text, #eef1f8);
    }
    .artist {
      font-size: 12px;
      color: var(--cz-text-dim, #9aa4bb);
    }
    .album {
      font-size: 11px;
      color: var(--cz-text-mute, #6b7488);
    }
    .center {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      flex: 1;
      min-width: 0;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      color: var(--cz-text-dim, #9aa4bb);
      transition:
        color 150ms ease,
        background 150ms ease,
        transform 150ms ease;
    }
    .icon-btn:hover {
      color: var(--cz-text, #eef1f8);
      background: color-mix(in srgb, var(--cz-text, #eef1f8) 8%, transparent);
    }
    .icon-btn:active {
      transform: scale(0.94);
    }
    .icon-btn[aria-pressed="true"] {
      color: var(--cz-accent, #8b5cf6);
    }
    .icon-btn.play {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--cz-grad, linear-gradient(135deg, #8b5cf6, #22d3ee));
      color: #08090d;
      box-shadow: 0 6px 18px rgba(139, 92, 246, 0.35);
      transition:
        transform 150ms cubic-bezier(0.2, 0, 0, 1),
        box-shadow 150ms ease,
        filter 150ms ease;
    }
    .icon-btn.play:hover {
      transform: translateY(-1px) scale(1.03);
      background: var(--cz-grad, linear-gradient(135deg, #8b5cf6, #22d3ee));
      color: #08090d;
      box-shadow:
        0 8px 26px rgba(139, 92, 246, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.08);
      filter: saturate(1.08);
    }
    .icon-btn.heart[aria-pressed="true"] {
      color: var(--cz-accent-2, #22d3ee);
    }
    .icon-btn.heart[aria-pressed="true"] svg {
      fill: currentColor;
    }
    .progress {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      max-width: 620px;
    }
    .progress .seek {
      flex: 1;
      width: auto;
      min-width: 80px;
    }
    .time {
      min-width: 38px;
      font-family: var(--cz-mono, "Cascadia Code", monospace);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      color: var(--cz-text-mute, #6b7488);
    }
    .time.current {
      text-align: right;
    }
    .time.duration {
      text-align: left;
    }
    .right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }
    .volume {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .volume .vol {
      width: 90px;
      flex: none;
    }
    @media (max-width: 1080px) {
      .album {
        display: none;
      }
      .left {
        flex-basis: 230px;
      }
    }
    @media (max-width: 860px) {
      .volume .vol {
        display: none;
      }
      .bar {
        gap: 12px;
      }
    }
  `;

  static override get observedAttributes(): string[] {
    return ["cover-url"];
  }

  private snapshotValue: PlayerSnapshot | null = null;
  private coverUrlValue: string | null = null;
  private liked = false;

  private bar: HTMLElement | null = null;
  private cover: CzCover | null = null;
  private titleEl: HTMLElement | null = null;
  private artistEl: HTMLElement | null = null;
  private albumEl: HTMLElement | null = null;
  private seek: CzSlider | null = null;
  private volume: CzSlider | null = null;
  private currentTimeEl: HTMLElement | null = null;
  private durationEl: HTMLElement | null = null;
  private playButton: IconButton | null = null;
  private shuffleButton: IconButton | null = null;
  private repeatButton: IconButton | null = null;
  private muteButton: IconButton | null = null;
  private heartButton: IconButton | null = null;

  get snapshot(): PlayerSnapshot | null {
    return this.snapshotValue;
  }

  set snapshot(value: PlayerSnapshot | null) {
    this.snapshotValue = value ?? null;
    this.invalidate();
  }

  get coverUrl(): string | null {
    return this.coverUrlValue;
  }

  set coverUrl(value: string | null) {
    this.coverUrlValue = typeof value === "string" && value.length > 0 ? value : null;
    this.invalidate();
  }

  override attributeChangedCallback(attributeName: string, _oldValue: string | null, newValue: string | null): void {
    if (attributeName === "cover-url") this.coverUrl = newValue;
  }

  protected override render(): void {
    if (!this.bar) this.build();
    this.update();
  }

  /* ---------------------------------------------------------------- skeleton */

  private makeButton(action: string, label: string, icon: string, size: number): IconButton {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `icon-btn ${action}`;
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    const svg = iconSvg(icon, size);
    button.append(svg);
    return { button, svg };
  }

  private build(): void {
    const bar = div("bar");

    /* left: cover + metadata + heart */
    const left = div("left");
    const coverSlot = div("cover-slot");
    const cover = document.createElement("cz-cover") as CzCover;
    cover.size = 56;
    coverSlot.append(cover);

    const meta = div("meta");
    const title = div("title");
    const artist = div("artist");
    const album = div("album");
    meta.append(title, artist, album);

    const heart = this.makeButton("heart", "Like this track", "heart", 18);
    heart.button.setAttribute("aria-pressed", "false");
    heart.button.addEventListener("click", () => {
      this.liked = !this.liked;
      heart.button.setAttribute("aria-pressed", String(this.liked));
      this.emit<LikeDetail>("cz-like", { liked: this.liked });
    });

    left.append(coverSlot, meta, heart.button);

    /* center: transport + progress */
    const center = div("center");
    const controls = div("controls");

    const prev = this.makeButton("prev", "Previous track", "prev", 18);
    prev.button.addEventListener("click", () => this.emit("cz-prev"));

    const play = this.makeButton("play", "Play", "play", 20);
    play.button.addEventListener("click", () => this.emit("cz-toggle"));

    const next = this.makeButton("next", "Next track", "next", 18);
    next.button.addEventListener("click", () => this.emit("cz-next"));

    controls.append(prev.button, play.button, next.button);

    const progress = div("progress");
    const currentTime = span("time current", "0:00");
    const seek = document.createElement("cz-slider") as CzSlider;
    seek.className = "seek";
    seek.label = "Seek";
    seek.step = 0.1;
    seek.formatValue = formatTime;
    seek.addEventListener("cz-input", (event) => {
      const detail = (event as CustomEvent<SliderValueDetail>).detail;
      if (detail) this.emit<SeekDetail>("cz-seek", { seconds: detail.value });
    });
    const duration = span("time duration", "0:00");
    progress.append(currentTime, seek, duration);
    center.append(controls, progress);

    /* right: shuffle / repeat / volume / queue */
    const right = div("right");

    const shuffle = this.makeButton("shuffle", "Shuffle", "shuffle", 18);
    shuffle.button.setAttribute("aria-pressed", "false");
    shuffle.button.addEventListener("click", () => {
      const nextState = !(this.snapshotValue?.shuffle ?? false);
      this.emit<ShuffleDetail>("cz-shuffle", { shuffle: nextState });
    });

    const repeat = this.makeButton("repeat", "Repeat mode", "repeat", 18);
    repeat.button.setAttribute("aria-pressed", "false");
    repeat.button.addEventListener("click", () => {
      const current = this.snapshotValue?.repeat ?? "off";
      const nextMode: RepeatMode = current === "off" ? "all" : current === "all" ? "one" : "off";
      this.emit<RepeatDetail>("cz-repeat", { repeat: nextMode });
    });

    const volume = div("volume");
    const mute = this.makeButton("mute", "Mute", "volume", 18);
    mute.button.addEventListener("click", () => this.emit("cz-mute"));
    const volumeSlider = document.createElement("cz-slider") as CzSlider;
    volumeSlider.className = "vol";
    volumeSlider.label = "Volume";
    volumeSlider.max = 1;
    volumeSlider.step = 0.01;
    volumeSlider.formatValue = (value: number) => `${Math.round(value * 100)}%`;
    volumeSlider.addEventListener("cz-input", (event) => {
      const detail = (event as CustomEvent<SliderValueDetail>).detail;
      if (detail) this.emit<VolumeDetail>("cz-volume", { volume: detail.value });
    });
    volume.append(mute.button, volumeSlider);

    const queue = this.makeButton("queue", "Toggle queue", "queue", 18);
    queue.button.addEventListener("click", () => this.emit("cz-toggle-queue"));

    right.append(shuffle.button, repeat.button, volume, queue.button);

    bar.append(left, center, right);
    this.replaceContent(bar);

    this.bar = bar;
    this.cover = cover;
    this.titleEl = title;
    this.artistEl = artist;
    this.albumEl = album;
    this.seek = seek;
    this.volume = volumeSlider;
    this.currentTimeEl = currentTime;
    this.durationEl = duration;
    this.playButton = play;
    this.shuffleButton = shuffle;
    this.repeatButton = repeat;
    this.muteButton = mute;
    this.heartButton = heart;
  }

  /* ----------------------------------------------------------------- updating */

  private update(): void {
    const snapshot = this.snapshotValue;
    const track = snapshot?.track ?? null;
    const playing = snapshot?.state === "playing";
    const duration = snapshot?.duration ?? track?.duration ?? 0;
    const position = snapshot?.position ?? 0;
    const repeat = snapshot?.repeat ?? "off";
    const shuffle = snapshot?.shuffle ?? false;
    const muted = snapshot?.muted ?? false;
    const volume = snapshot?.volume ?? 1;
    const buffered = snapshot?.buffered ?? 0;

    if (this.titleEl) {
      const title = track?.title || "Nothing playing";
      this.titleEl.textContent = title;
      this.titleEl.setAttribute("title", title);
    }
    if (this.artistEl) this.artistEl.textContent = track ? track.artist || "Unknown artist" : "Choose a track to begin";
    if (this.albumEl) {
      const album = track?.album ?? "";
      this.albumEl.textContent = album;
      this.albumEl.hidden = album.length === 0;
    }

    if (this.cover) {
      this.cover.src = this.coverUrlValue;
      this.cover.seed = track?.coverId || track?.album || track?.title || "cadenza";
    }

    if (this.playButton) {
      paintIcon(this.playButton.svg, playing ? "pause" : "play", 20);
      this.playButton.button.setAttribute("aria-label", playing ? "Pause" : "Play");
    }

    if (this.seek) {
      if (!this.seek.isDragging) {
        this.seek.max = duration > 0 ? duration : 1;
        this.seek.value = Math.min(position, duration > 0 ? duration : position);
      }
      this.seek.buffered = duration > 0 ? Math.max(0, Math.min(1, buffered / duration)) : 0;
    }

    if (this.currentTimeEl) this.currentTimeEl.textContent = formatTime(position);
    if (this.durationEl) this.durationEl.textContent = formatTime(duration);

    if (this.shuffleButton) {
      this.shuffleButton.button.setAttribute("aria-pressed", String(shuffle));
      this.shuffleButton.button.setAttribute("aria-label", shuffle ? "Shuffle on" : "Shuffle off");
    }

    if (this.repeatButton) {
      paintIcon(this.repeatButton.svg, repeat === "one" ? "repeat-one" : "repeat", 18);
      this.repeatButton.button.setAttribute("aria-pressed", String(repeat !== "off"));
      this.repeatButton.button.setAttribute("aria-label", `Repeat ${repeat}`);
    }

    if (this.muteButton) {
      paintIcon(this.muteButton.svg, muted ? "volume-off" : "volume", 18);
      this.muteButton.button.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      this.muteButton.button.setAttribute("aria-pressed", String(muted));
    }

    if (this.volume && !this.volume.isDragging) {
      this.volume.value = muted ? 0 : volume;
    }

    if (this.heartButton) {
      this.heartButton.button.setAttribute("aria-pressed", String(this.liked));
    }
  }
}




