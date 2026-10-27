/**
 * Albums view: a responsive cover grid. Clicking an album drills into its
 * track list (driven by `state.filter`).
 */

import { h, icon } from "../dom.js";
import {
  albumViews,
  resolveCover,
  visibleTracks,
  type AlbumView,
  type AppState,
  type TrackListElement,
  type UiContext,
  type ViewPart,
} from "../state.js";
import type { Track } from "@fanduck/cadenza-core";

/** The subset of `<cz-cover>` used here. */
interface CoverElement extends HTMLElement {
  src: string | null;
  seed: string;
  size: number;
}

interface EmptyStateElement extends HTMLElement {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
}

export function createAlbumsView(ctx: UiContext): ViewPart {
  const grid = h("div", { class: "album-grid" });

  const empty = document.createElement("cz-empty-state") as unknown as EmptyStateElement;
  empty.icon = "album";
  empty.title = "No albums yet";
  empty.description = "Albums appear here once your library has scanned some music.";
  empty.actionLabel = "Add music folder";
  empty.addEventListener("cz-action", () => {
    void ctx.actions.addMusicFolder();
  });
  const emptyWrap = h("div", { class: "empty-wrap" }, empty);

  /* --------------------------------------------------------------- track list */

  const list = document.createElement("cz-track-list") as unknown as TrackListElement;
  list.variant = "full";
  list.showHeader = true;
  list.emptyText = "No tracks in this album";
  list.tracks = [];
  list.currentId = null;
  list.playing = false;
  list.hidden = true;

  list.addEventListener("cz-activate", ((event: Event) => {
    const detail = detailOf<{ track: Track; index: number }>(event);
    if (!detail) return;
    ctx.actions.playTracks(albumTracks(detail.track.album, detail.track.albumArtist ?? detail.track.artist), detail.index);
  }) as EventListener);

  list.addEventListener("cz-menu", ((event: Event) => {
    const detail = detailOf<{ track: Track; x: number; y: number }>(event);
    if (!detail) return;
    ctx.actions.showTrackMenu(detail.track, detail.x, detail.y);
  }) as EventListener);

  /* ------------------------------------------------------------- filter bar */

  const filterChip = h("span", { class: "filter-chip" });
  const filterBar = h("div", { class: "filter-bar" }, filterChip);
  filterBar.hidden = true;

  const el = h("div", { class: "view" }, filterBar, grid, emptyWrap, list);

  let generation = 0;
  let destroyed = false;

  const unsubscribePlayer = ctx.player.onSnapshot((snapshot) => {
    list.currentId = snapshot.track?.id ?? null;
    list.playing = snapshot.state === "playing";
  });

  /** Tracks of one album, in disc/track order (not the user's global sort). */
  function albumTracks(album: string, artist: string): Track[] {
    return ctx.library
      .tracks()
      .filter((track) => track.album === album && (track.albumArtist ?? track.artist) === artist)
      .sort((a, b) => (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 0) - (b.trackNo ?? 0));
  }

  /* ------------------------------------------------------------------ cards */

  function createAlbumCard(album: AlbumView, currentGeneration: number): HTMLElement {
    const cover = document.createElement("cz-cover") as unknown as CoverElement;
    cover.seed = `${album.artist} | ${album.album}`;
    cover.size = 160;
    cover.src = null;
    if (album.coverId) {
      void resolveCover(ctx.bridge, album.coverId).then((url) => {
        if (!destroyed && currentGeneration === generation && url) cover.src = url;
      });
    }

    const playButton = h(
      "button",
      {
        class: "album-card__play",
        type: "button",
        aria: { label: `Play ${album.album} by ${album.artist}` },
        on: {
          click: (event) => {
            event.stopPropagation();
            ctx.actions.playTracks(albumTracks(album.album, album.artist));
          },
        },
      },
      icon("play", 17),
    );

    const open = (): void => {
      ctx.actions.setFilter({ kind: "album", album: album.album, artist: album.artist });
    };

    return h(
      "div",
      {
        class: "album-card",
        role: "button",
        tabIndex: 0,
        aria: { label: `Open album ${album.album} by ${album.artist}` },
        on: {
          click: open,
          keydown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          },
        },
      },
      h("div", { class: "album-card__cover" }, cover, playButton),
      h(
        "div",
        { class: "album-card__text" },
        h("p", { class: "album-card__title", text: album.album }),
        h("p", { class: "album-card__meta", text: `${album.artist} | ${album.tracks.length} tracks` }),
      ),
    );
  }

  /* ----------------------------------------------------------------- update */

  function update(state: AppState): void {
    generation += 1;
    const currentGeneration = generation;
    const filter = state.filter;

    if (filter && filter.kind === "album") {
      const tracks = albumTracks(filter.album, filter.artist);
      grid.hidden = true;
      emptyWrap.hidden = true;
      filterBar.hidden = false;
      list.hidden = false;
      list.tracks = tracks;
      list.currentId = ctx.player.snapshot.track?.id ?? null;
      list.playing = ctx.player.snapshot.state === "playing";
      filterChip.replaceChildren(
        h("span", {}, "Album: ", h("strong", { text: filter.album }), ` - ${filter.artist}`),
        h(
          "button",
          {
            class: "filter-clear",
            type: "button",
            aria: { label: "Back to all albums" },
            on: { click: () => ctx.actions.setFilter(null) },
          },
          icon("close", 13),
        ),
      );
      return;
    }

    filterBar.hidden = true;
    list.hidden = true;

    const tracks = visibleTracks(state);
    const albums = albumViews(tracks).sort((a, b) => compareAlbums(a, b, state));
    grid.replaceChildren(...albums.map((album) => createAlbumCard(album, currentGeneration)));
    grid.hidden = albums.length === 0;
    emptyWrap.hidden = albums.length > 0;
  }

  return {
    el,
    update,
    destroy(): void {
      destroyed = true;
      unsubscribePlayer();
    },
  };
}

/** Sort album cards according to the toolbar's sort menu. */
function compareAlbums(a: AlbumView, b: AlbumView, state: AppState): number {
  const direction = state.sort.dir === "asc" ? 1 : -1;
  switch (state.sort.key) {
    case "artist":
    case "albumArtist":
      return a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }) * direction;
    case "year":
      return ((a.year ?? 0) - (b.year ?? 0)) * direction;
    case "added":
      return (
        ((a.tracks[0]?.addedAt ?? 0) - (b.tracks[0]?.addedAt ?? 0)) * direction
      );
    case "duration":
      return ((a.duration ?? 0) - (b.duration ?? 0)) * direction;
    case "title":
    case "album":
    default:
      return a.album.localeCompare(b.album, undefined, { sensitivity: "base" }) * direction;
  }
}

function detailOf<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent)) return null;
  return (event.detail as T | null) ?? null;
}
