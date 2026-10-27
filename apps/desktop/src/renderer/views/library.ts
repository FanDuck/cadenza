/**
 * Library view: a full track list, scan progress and the "add music" empty state.
 */

import { h, icon, setText } from "../dom.js";
import {
  describeCount,
  describeDuration,
  visibleTracks,
  type AppState,
  type TrackListElement,
  type UiContext,
  type ViewPart,
} from "../state.js";
import type { ScanProgress, Track } from "@fanduck/cadenza-core";

/** The subset of `<cz-empty-state>` used here. */
interface EmptyStateElement extends HTMLElement {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
}

interface TrackActivateDetail {
  track: Track;
  index: number;
}

interface TrackMenuDetail {
  track: Track;
  index: number;
  x: number;
  y: number;
}

export function createLibraryView(ctx: UiContext): ViewPart {
  /* ------------------------------------------------------------ empty state */

  const empty = document.createElement("cz-empty-state") as unknown as EmptyStateElement;
  empty.icon = "music";
  empty.title = "Your library is empty";
  empty.description = "Add a folder of music and Cadenza will read the tags, cover art and durations. Nothing is uploaded anywhere.";
  empty.actionLabel = "Add music folder";
  empty.addEventListener("cz-action", () => {
    void ctx.actions.addMusicFolder();
  });

  const emptyWrap = h("div", { class: "empty-wrap" }, empty);

  /* ------------------------------------------------------------ scan strip */

  const scanText = h("span", { class: "scan-strip__text", text: "Scanning..." });
  const scanFill = h("div", { class: "scan-strip__fill" });
  const scanCancel = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Cancel the library scan" },
      on: { click: () => void ctx.bridge.library.cancelScan() },
    },
    h("span", { text: "Cancel" }),
  );
  const scanStrip = h(
    "div",
    { class: "scan-strip", attrs: { role: "status", "aria-live": "polite" } },
    scanText,
    h("div", { class: "scan-strip__bar" }, scanFill),
    scanCancel,
  );
  scanStrip.hidden = true;

  /* -------------------------------------------------------------- track list */

  const list = document.createElement("cz-track-list") as unknown as TrackListElement;
  list.variant = "full";
  list.showHeader = true;
  list.emptyText = "No tracks match your search";
  list.tracks = [];
  list.currentId = null;
  list.playing = false;

  /* ---------------------------------------------------------------- toolbar */

  const hint = h("span", { class: "view-hint", text: "" });

  const addButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Add a music folder" },
      on: { click: () => void ctx.actions.addMusicFolder() },
    },
    icon("folder", 15),
    h("span", { text: "Add folder" }),
  );

  const rescanButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Rescan the music folders" },
      on: { click: () => void ctx.actions.rescan() },
    },
    icon("refresh", 15),
    h("span", { text: "Rescan" }),
  );

  const toolbar = h("div", { class: "view-actions" }, hint, h("div", { class: "view-actions__spacer" }), addButton, rescanButton);

  /* ------------------------------------------------------------- filter bar */

  const filterChip = h("span", { class: "filter-chip" });
  const filterBar = h("div", { class: "filter-bar" }, filterChip);
  filterBar.hidden = true;

  const el = h("div", { class: "view" }, filterBar, toolbar, scanStrip, emptyWrap, list);

  /* ---------------------------------------------------------------- events */

  list.addEventListener("cz-activate", ((event: Event) => {
    const detail = detailOf<TrackActivateDetail>(event);
    if (!detail) return;
    ctx.actions.playTracks(visibleTracks(), detail.index);
  }) as EventListener);

  list.addEventListener("cz-menu", ((event: Event) => {
    const detail = detailOf<TrackMenuDetail>(event);
    if (!detail) return;
    ctx.actions.showTrackMenu(detail.track, detail.x, detail.y);
  }) as EventListener);

  const unsubscribePlayer = ctx.player.onSnapshot((snapshot) => {
    list.currentId = snapshot.track?.id ?? null;
    list.playing = snapshot.state === "playing";
  });

  /* ----------------------------------------------------------------- update */

  function update(state: AppState): void {
    const tracks = visibleTracks(state);
    list.tracks = tracks;
    list.currentId = ctx.player.snapshot.track?.id ?? null;
    list.playing = ctx.player.snapshot.state === "playing";

    const scanning = state.scan !== null && (state.scan.phase === "discovering" || state.scan.phase === "reading");
    const hasTracks = state.tracks.length > 0;
    const filtered = state.filter !== null || state.query.trim().length > 0;

    list.hidden = !hasTracks;
    list.emptyText = filtered ? "No tracks match your search" : "Your library is empty";
    emptyWrap.hidden = hasTracks || scanning;
    rescanButton.disabled = scanning || state.settings.libraryRoots.length === 0;
    // The view header already shows the totals, so this hint only earns its place
    // when a filter is narrowing the list.
    hint.textContent = filtered
      ? `${describeCount(tracks.length, "song")} of ${describeCount(state.tracks.length, "song")}`
      : "";

    updateFilter(state);
    updateScan(state.scan);
  }

  function updateFilter(state: AppState): void {
    const filter = state.filter;
    if (!filter) {
      filterBar.hidden = true;
      return;
    }
    filterBar.hidden = false;
    filterChip.replaceChildren(
      filter.kind === "album"
        ? h("span", {}, "Album: ", h("strong", { text: filter.album }), ` - ${filter.artist}`)
        : h("span", {}, "Artist: ", h("strong", { text: filter.artist })),
      h(
        "button",
        {
          class: "filter-clear",
          type: "button",
          aria: { label: "Clear the filter" },
          on: { click: () => ctx.actions.setFilter(null) },
        },
        icon("close", 13),
      ),
    );
  }

  function updateScan(scan: ScanProgress | null): void {
    const active = scan !== null && (scan.phase === "discovering" || scan.phase === "reading");
    scanStrip.hidden = !active;
    if (!scan || !active) return;

    const found = scan.filesFound;
    const processed = scan.filesProcessed;
    const ratio = found > 0 ? Math.min(1, processed / found) : 0;
    scanFill.style.width = `${Math.round(ratio * 100)}%`;
    if (scan.phase === "discovering") {
      setText(scanText, "Looking for music files...");
    } else {
      setText(scanText, `Reading tags... ${processed} / ${found}`);
    }
    // The strip is only rendered while scanning, so the button is always valid.
    scanCancel.disabled = false;
  }

  return {
    el,
    update,
    destroy(): void {
      unsubscribePlayer();
    },
  };
}

function detailOf<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent)) return null;
  return (event.detail as T | null) ?? null;
}
