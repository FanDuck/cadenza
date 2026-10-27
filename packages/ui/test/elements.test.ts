/**
 * Smoke tests for the Cadenza UI kit.
 *
 * jsdom is used as a minimal DOM. The compiled package in `../dist` is imported
 * after the globals are installed, because every element class extends
 * `HTMLElement` at module evaluation time.
 *
 * Run with: node --test --test-isolation=none packages/ui/test/
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

interface TestWindow {
  document: Document;
  customElements: CustomElementRegistry;
  MouseEvent: typeof MouseEvent;
  KeyboardEvent: typeof KeyboardEvent;
  close(): void;
}

interface TestDom {
  window: TestWindow;
}

type JSDOMConstructor = new (html?: string, options?: { url?: string; virtualConsole?: unknown }) => TestDom;

interface JSDOMLike {
  JSDOM: JSDOMConstructor;
  VirtualConsole: new () => unknown;
}

/**
 * Load jsdom. The direct dynamic import is the normal path; the fallback exists
 * because pnpm's Windows junction layout can leave `node_modules/jsdom` unable
 * to resolve its own dependencies (`tough-cookie`) from the workspace root.
 */
async function loadJSDOM(): Promise<JSDOMLike> {
  try {
    return (await import("jsdom")) as unknown as JSDOMLike;
  } catch {
    const require = createRequire(import.meta.url);
    const entry = realpathSync.native(require.resolve("jsdom"));
    return require(entry) as JSDOMLike;
  }
}

const jsdom = await loadJSDOM();
// A bare VirtualConsole swallows jsdom "not implemented" reports (canvas 2d is
// unavailable in jsdom without the native canvas package).
const dom = new jsdom.JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  virtualConsole: new jsdom.VirtualConsole(),
});
const domWindow = dom.window;

const scope = globalThis as unknown as Record<string, unknown>;
for (const key of [
  "window",
  "document",
  "customElements",
  "HTMLElement",
  "Element",
  "Node",
  "CustomEvent",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "CSSStyleSheet",
  "ShadowRoot",
  "Document",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "ResizeObserver",
  "devicePixelRatio",
]) {
  scope[key] = (domWindow as unknown as Record<string, unknown>)[key];
}

const ui = await import("../dist/index.js");
ui.defineCadenzaElements();

interface TestTrack {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  addedAt: number;
}

function makeTracks(count: number): TestTrack[] {
  const tracks: TestTrack[] = [];
  for (let index = 0; index < count; index += 1) {
    tracks.push({
      id: `track-${index}`,
      path: `C:\\music\\track-${index}.flac`,
      title: `Track ${index}`,
      artist: `Artist ${index % 7}`,
      album: `Album ${index % 5}`,
      duration: 180 + index,
      addedAt: 1_700_000_000_000 + index,
    });
  }
  return tracks;
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

after(() => {
  domWindow.close();
});

test("cz-track-list renders one row per track and caps the full variant at 400", async () => {
  const list = document.createElement("cz-track-list") as HTMLElement & { tracks: TestTrack[]; variant: string };

  list.tracks = makeTracks(3);
  await flush();
  assert.equal(list.shadowRoot?.querySelectorAll(".row").length, 3);

  list.tracks = makeTracks(450);
  await flush();
  assert.equal(list.shadowRoot?.querySelectorAll(".row").length, 400);
  assert.ok(list.shadowRoot?.querySelector(".more"), "show-more button is rendered past the cap");
});

test("clicking a row dispatches cz-activate with the right track and index", async () => {
  const list = document.createElement("cz-track-list") as HTMLElement & { tracks: TestTrack[] };
  const tracks = makeTracks(3);
  list.tracks = tracks;
  await flush();

  let received: { track: TestTrack; index: number } | null = null;
  list.addEventListener("cz-activate", (event) => {
    received = (event as CustomEvent<{ track: TestTrack; index: number }>).detail;
  });

  const rows = list.shadowRoot?.querySelectorAll<HTMLElement>(".row");
  assert.ok(rows && rows.length >= 3);
  rows[2]?.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));

  assert.ok(received, "cz-activate fired");
  assert.equal(received.index, 2);
  assert.equal(received.track.id, tracks[2]?.id);
});

test("cz-slider clamps values and emits cz-change with the clamped result", async () => {
  const slider = document.createElement("cz-slider") as HTMLElement & {
    value: number;
    min: number;
    max: number;
    step: number;
  };
  slider.min = 0;
  slider.max = 10;
  slider.value = 42;
  await flush();

  assert.equal(slider.value, 10, "value is clamped to max");
  assert.equal(slider.getAttribute("aria-valuenow"), "10");

  let changed: number | null = null;
  slider.addEventListener("cz-change", (event) => {
    changed = (event as CustomEvent<{ value: number }>).detail.value;
  });

  slider.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "Home", cancelable: true }));
  assert.equal(slider.value, 0, "Home moves to min");
  assert.equal(changed, 0, "cz-change carries the clamped value");
});

test("cz-cover falls back to a deterministic gradient when src is null", async () => {
  const cover = document.createElement("cz-cover") as HTMLElement & { src: string | null; seed: string };
  cover.src = null;
  cover.seed = "track-42";
  await flush();

  const root = cover.shadowRoot;
  assert.ok(root);
  assert.equal(root.querySelector("img"), null, "no <img> is rendered for the fallback");
  const fallback = root.querySelector<HTMLElement>("[data-fallback]");
  assert.ok(fallback, "gradient fallback element exists");
  assert.match(fallback.style.backgroundImage, /linear-gradient/);

  const firstGradient = fallback.style.backgroundImage;
  cover.src = null;
  cover.seed = "track-42";
  await flush();
  const again = root.querySelector<HTMLElement>("[data-fallback]");
  assert.equal(again?.style.backgroundImage, firstGradient, "same seed produces the same artwork");

  assert.ok(root.querySelector("style"), "the <style> fallback path is used when constructable sheets are missing");
});

test("the remaining elements upgrade and render their shadow shells", async () => {
  const [track] = makeTracks(1);
  assert.ok(track);

  const player = document.createElement("cz-now-playing") as HTMLElement & {
    snapshot: unknown;
    coverUrl: string | null;
  };
  player.snapshot = {
    state: "playing",
    track,
    position: 42,
    duration: 240,
    buffered: 120,
    volume: 0.8,
    muted: false,
    shuffle: true,
    repeat: "all",
    error: null,
  };
  player.coverUrl = null;
  await flush();
  assert.ok(player.shadowRoot?.querySelector(".bar"), "transport bar renders");
  assert.ok(player.shadowRoot?.querySelector("cz-cover"), "cover child renders");
  assert.ok(player.shadowRoot?.querySelector("cz-slider"), "seek slider child renders");
  const playLabel = player.shadowRoot?.querySelector(".play")?.getAttribute("aria-label");
  assert.equal(playLabel, "Pause", "play button reflects the playing state");

  const visualizer = document.createElement("cz-visualizer") as HTMLElement & {
    analyser: unknown;
    playing: boolean;
    bars: number;
    height: number;
  };
  visualizer.analyser = null;
  visualizer.playing = true;
  visualizer.bars = 32;
  visualizer.height = 48;
  await flush();
  assert.ok(visualizer.shadowRoot?.querySelector("canvas"), "visualizer canvas renders");

  const lyrics = document.createElement("cz-lyrics") as HTMLElement & {
    doc: unknown;
    position: number;
    title: string;
  };
  lyrics.title = "Track 0";
  lyrics.doc = {
    offset: 0,
    source: "sidecar",
    lines: [
      { time: 0, text: "first line" },
      { time: 5, text: "second line" },
    ],
  };
  lyrics.position = 6;
  await flush();
  assert.equal(lyrics.shadowRoot?.querySelectorAll(".line").length, 2, "lyrics lines render");
  assert.equal(lyrics.shadowRoot?.querySelector(".line.active")?.textContent, "second line", "active line follows position");

  const empty = document.createElement("cz-empty-state") as HTMLElement & {
    title: string;
    description: string;
    actionLabel: string;
  };
  empty.title = "No library";
  empty.description = "Scan a folder to get started";
  empty.actionLabel = "Scan folder";
  await flush();
  let actions = 0;
  empty.addEventListener("cz-action", () => {
    actions += 1;
  });
  empty.shadowRoot
    ?.querySelector(".action")
    ?.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, composed: true }));
  assert.equal(actions, 1, "cz-action fires from the empty-state button");

  const toast = document.createElement("cz-toast-host") as HTMLElement & {
    show: (message: string, kind?: string, durationMs?: number) => void;
    dismissAll: () => void;
  };
  toast.show("Scanned 12 tracks", "success", 1000);
  assert.equal(toast.shadowRoot?.querySelectorAll(".toast").length, 1, "toast is stacked");
  toast.dismissAll();
});

