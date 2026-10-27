/**
 * Renderer smoke test.
 *
 * There is no browser in CI, but the renderer is plain ES modules, so we can
 * boot the real compiled bundle inside jsdom: it exercises the demo bridge, the
 * core player, the UI components and the view rendering code end to end.
 *
 * It is not a pixel test - it answers "does the app start and paint the shell
 * without throwing, and do the main views produce DOM?".
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, "..");
const html = fs.readFileSync(path.join(appRoot, "src", "renderer", "index.html"), "utf8");
const entry = path.join(appRoot, "dist", "renderer", "main.js");

interface JSDOMLike {
  JSDOM: new (html?: string, options?: Record<string, unknown>) => { window: Window & typeof globalThis };
  VirtualConsole: new () => unknown;
}

/**
 * Load jsdom. The direct dynamic import is the normal path; the fallback exists
 * because pnpm's Windows junction layout can leave `node_modules/jsdom` unable
 * to resolve its own dependencies from the workspace root.
 */
async function loadJSDOM(): Promise<JSDOMLike> {
  try {
    return (await import("jsdom")) as unknown as JSDOMLike;
  } catch {
    const resolved = require.resolve("jsdom");
    const entryPoint = fs.realpathSync.native(resolved);
    return require(entryPoint) as JSDOMLike;
  }
}

const jsdom = await loadJSDOM();

/**
 * The demo bridge keeps a 250ms interval alive once playback starts. jsdom
 * timers keep the Node event loop busy, so the window is closed after the tests
 * or the test process would never exit.
 */
let activeWindow: { close(): void } | null = null;
after(() => {
  activeWindow?.close();
});

/** Minimal 2D context so the visualiser does not explode without node-canvas. */
function fakeContext2d() {
  const noop = () => undefined;
  return {
    canvas: { width: 300, height: 100 },
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    set globalAlpha(value: number) {},
    set fillStyle(value: unknown) {},
    set strokeStyle(value: unknown) {},
    set lineWidth(value: number) {},
    set lineCap(value: unknown) {},
  };
}

/** Enough of AnalyserNode for the visualiser's draw loop. */
function fakeAnalyser() {
  const bins = new Uint8Array(64);
  return {
    fftSize: 128,
    frequencyBinCount: bins.length,
    getByteFrequencyData(target: Uint8Array) {
      for (let i = 0; i < target.length; i += 1) target[i] = (i * 7) % 255;
    },
    getByteTimeDomainData(target: Uint8Array) {
      target.fill(128);
    },
    connect() {},
    disconnect() {},
  };
}

function installDom() {
  const dom = new jsdom.JSDOM(html, {
    url: "http://127.0.0.1:5199/apps/desktop/dist/renderer/index.html",
    pretendToBeVisual: true,
    runScripts: "outside-only",
    // A bare VirtualConsole swallows jsdom "not implemented" noise (canvas 2d).
    virtualConsole: new jsdom.VirtualConsole(),
  });

  const window = dom.window;

  /**
   * Node 24 exposes some of these as getter-only globals, so plain assignment
   * throws. defineProperty with configurable:true works for every name.
   */
  const setGlobal = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
  };

  const inheritedFromWindow = [
    "window",
    "document",
    "navigator",
    "location",
    "history",
    "HTMLElement",
    "HTMLAudioElement",
    "HTMLMediaElement",
    "HTMLCanvasElement",
    "Audio",
    "Image",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "DOMParser",
    "localStorage",
    "sessionStorage",
    // Web Components plumbing the UI kit relies on.
    "customElements",
    "CustomElementRegistry",
    "CSSStyleSheet",
    "ShadowRoot",
    "DocumentFragment",
    "HTMLTemplateElement",
    "EventTarget",
    "Text",
    "Comment",
    "NodeList",
    "HTMLCollection",
  ] as const;
  for (const name of inheritedFromWindow) {
    setGlobal(name, (window as unknown as Record<string, unknown>)[name]);
  }

  setGlobal("DragEvent", window.DragEvent ?? window.Event);
  setGlobal("PointerEvent", window.PointerEvent ?? window.Event);
  setGlobal("getComputedStyle", window.getComputedStyle.bind(window));
  setGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 16) as unknown as number);
  setGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  setGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));

  setGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  setGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );

  class FakeAudioContext {
    createAnalyser() {
      return fakeAnalyser();
    }
    createMediaElementSource() {
      return { connect() {}, disconnect() {} };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  setGlobal("AudioContext", FakeAudioContext);
  setGlobal("webkitAudioContext", FakeAudioContext);

  // jsdom has no canvas implementation; give elements a context that draws nothing.
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return fakeContext2d() as unknown as CanvasRenderingContext2D;
  } as typeof window.HTMLCanvasElement.prototype.getContext;

  // <audio> playback is not implemented in jsdom; the demo path never needs it,
  // but a stray call must not crash the app.
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => undefined;
  window.HTMLMediaElement.prototype.load = () => undefined;

  return window;
}

test("renderer boots in jsdom and paints the shell", async () => {
  const window = installDom();
  activeWindow = window;

  // The demo bridge takes over because window.cadenza is absent.
  await import(`file://${entry.replace(/\\/g, "/")}`);

  // The boot sequence is async (settings, library, plugins); give it room.
  await new Promise((resolve) => setTimeout(resolve, 400));

  const doc = window.document;
  const app = doc.getElementById("app");
  assert.ok(app, "#app exists");

  const text = app.textContent ?? "";
  assert.ok(text.length > 0, "the app rendered some text");

  // The shell must contain the primary navigation and the player bar.
  const sidebarLinks = app.querySelectorAll("button, a, [role='button'], [role='menuitem']");
  assert.ok(sidebarLinks.length > 5, `navigation rendered (found ${sidebarLinks.length} controls)`);

  // Custom elements from the UI kit must be registered and mounted.
  const registered = ["cz-icon", "cz-track-list", "cz-now-playing"].filter((tag) =>
    window.customElements.get(tag) !== undefined,
  );
  assert.deepEqual(registered, ["cz-icon", "cz-track-list", "cz-now-playing"], "custom elements registered");

  // Demo library should have tracks on screen (library view is the default).
  const rows = app.querySelectorAll("cz-track-list");
  assert.ok(rows.length > 0, "a track list is mounted");

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = (element: Element) =>
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));

  // --- navigating to Albums renders an album grid -------------------------
  const albumsNav = [...app.querySelectorAll("button")].find((button) =>
    /^album/i.test((button.textContent ?? "").trim()),
  );
  assert.ok(albumsNav, "the sidebar has an Albums entry");
  click(albumsNav);
  await sleep(150);

  const albumCards = app.querySelectorAll(".album-card");
  assert.ok(albumCards.length >= 4, `album grid rendered (${albumCards.length} cards)`);

  // --- command palette opens, lists commands and closes on Escape ---------
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  await sleep(150);

  const palette = doc.querySelector(".palette");
  assert.ok(palette, "Ctrl+K opens the command palette");
  const paletteItems = palette.querySelectorAll("[role='option'], .palette__item, button");
  assert.ok(paletteItems.length > 10, `palette lists commands (${paletteItems.length} entries)`);

  // Escape is handled by the palette input, which owns focus in a real window.
  const paletteInput = palette.querySelector<HTMLInputElement>("input");
  paletteInput?.focus();
  (paletteInput ?? palette).dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await sleep(150);

  /** The palette hides itself rather than removing its DOM, so check ancestors. */
  const isHidden = (element: Element | null): boolean => {
    let node: Element | null = element;
    while (node) {
      if ((node as HTMLElement).hidden) return true;
      node = node.parentElement;
    }
    return false;
  };
  assert.ok(isHidden(palette), "Escape closes the command palette");

  // --- starting a track updates the now playing bar and window title ------
  const libraryNav = [...app.querySelectorAll("button")].find((button) =>
    /^library/i.test((button.textContent ?? "").trim()),
  );
  assert.ok(libraryNav, "the sidebar has a Library entry");
  click(libraryNav);
  await sleep(150);

  const list = app.querySelector("cz-track-list");
  const firstRow = list?.shadowRoot?.querySelector("[data-index], .row");
  assert.ok(firstRow, "the track list exposes rows inside its shadow root");
  click(firstRow);
  await sleep(250);

  const nowPlaying = app.querySelector("cz-now-playing");
  const nowText = (nowPlaying?.shadowRoot?.textContent ?? "").replace(/\s+/g, " ");
  assert.ok(nowText.length > 0, "the now playing bar has content after starting a track");
  assert.notEqual(doc.title, "Cadenza", `the window title shows the current track (got "${doc.title}")`);

  const errors = (window as unknown as { __cadenzaErrors?: unknown[] }).__cadenzaErrors ?? [];
  assert.equal(errors.length, 0, `no uncaught renderer errors (${JSON.stringify(errors)})`);
});
