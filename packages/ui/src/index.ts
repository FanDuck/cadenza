/**
 * `@fanduck/cadenza-ui` - themeable Web Components for Cadenza.
 *
 * The kit ships as native ES modules (no bundler). Import this entry, load
 * `theme.css` once at the document level, then call `defineCadenzaElements()`
 * a single time before using any `<cz-*>` tag:
 *
 *     <link rel="stylesheet" href="/packages/ui/src/theme.css" />
 *     <script type="module">
 *       import { defineCadenzaElements } from "@fanduck/cadenza-ui";
 *       defineCadenzaElements();
 *     </script>
 *
 * Element classes are exported for hosts that want to subclass them or build
 * elements in JavaScript; the tag names are the stable public surface.
 */

export { CzElement } from "./base.js";

export { CzIcon } from "./components/icon.js";
export { CzSlider } from "./components/slider.js";
export { CzCover } from "./components/cover.js";
export { CzTrackList } from "./components/track-list.js";
export { CzNowPlaying } from "./components/now-playing.js";
export { CzVisualizer } from "./components/visualizer.js";
export { CzLyrics } from "./components/lyrics.js";
export { CzEmptyState } from "./components/empty-state.js";
export { CzToastHost } from "./components/toast.js";

import { CzIcon } from "./components/icon.js";
import { CzSlider } from "./components/slider.js";
import { CzCover } from "./components/cover.js";
import { CzTrackList } from "./components/track-list.js";
import { CzNowPlaying } from "./components/now-playing.js";
import { CzVisualizer } from "./components/visualizer.js";
import { CzLyrics } from "./components/lyrics.js";
import { CzEmptyState } from "./components/empty-state.js";
import { CzToastHost } from "./components/toast.js";

type ElementConstructor = CustomElementConstructor;

/**
 * Register every Cadenza custom element exactly once.
 *
 * Idempotent: repeated calls (and double-loaded modules) are a no-op, and tags
 * already registered by the host are left untouched.
 */
export function defineCadenzaElements(): void {
  if (typeof customElements === "undefined") return;

  const registry: ReadonlyArray<readonly [string, ElementConstructor]> = [
    ["cz-icon", CzIcon],
    ["cz-slider", CzSlider],
    ["cz-cover", CzCover],
    ["cz-track-list", CzTrackList],
    ["cz-now-playing", CzNowPlaying],
    ["cz-visualizer", CzVisualizer],
    ["cz-lyrics", CzLyrics],
    ["cz-empty-state", CzEmptyState],
    ["cz-toast-host", CzToastHost],
  ];

  for (const [tag, constructor] of registry) {
    if (!customElements.get(tag)) customElements.define(tag, constructor);
  }
}
