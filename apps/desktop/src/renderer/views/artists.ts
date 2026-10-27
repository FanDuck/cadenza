/**
 * Artists view: one row per artist, click to drill into their tracks.
 */

import { h, icon } from "../dom.js";
import {
  artistViews,
  describeCount,
  resolveCover,
  visibleTracks,
  type AppState,
  type TrackListElement,
  type UiContext,
  type ViewPart,
} from "../state.js";
import type { Track } from "@fanduck/cadenza-core";

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

export function createArtistsView(ctx: UiContext): ViewPart {
  const listEl = h("div", { class: "artist-list" });

  const empty = document.createElement("cz-empty-state") as unknown as EmptyStateElement;
  empty.icon = "artist";
  empty.title = "No artists yet";
  empty.description = "Artists are grouped from your library automatically. Add a music folder to get started.";
  empty.actionLabel = "Add music folder";
  empty.addEventListener("cz-action", () => {
    void ctx.actions.addMusicFolder();
  });
  const emptyWrap = h("div", { class: "empty-wrap" }, empty);

  const trackList = document.createElement("cz-track-list") as unknown as TrackListElement;
  trackList.variant = "full";
  trackList.showHeader = false;
  trackList.emptyText = "No tracks by this artist";
  trackList.tracks = [];
  trackList.currentId = null;
  trackList.playing = false;
  trackList.hidden = true;

  trackList.addEventListener("cz-activate", ((event: Event) => {
    const detail = detailOf<{ track: Track; index: number }>(event);
    if (!detail) return;
    ctx.actions.playTracks(artistTracks(detail.track.artist), detail.index);
  }) as EventListener);

  trackList.addEventListener("cz-menu", ((event: Event) => {
    const detail = detailOf<{ track: Track; x: number; y: number }>(event);
    if (!detail) return;
    ctx.actions.showTrackMenu(detail.track, detail.x, detail.y);
  }) as EventListener);

  const filterChip = h("span", { class: "filter-chip" });
  const filterBar = h("div", { class: "filter-bar" }, filterChip);
  filterBar.hidden = true;

  const el = h("div", { class: "view" }, filterBar, listEl, emptyWrap, trackList);

  let generation = 0;
  let destroyed = false;

  const unsubscribePlayer = ctx.player.onSnapshot((snapshot) => {
    trackList.currentId = snapshot.track?.id ?? null;
    trackList.playing = snapshot.state === "playing";
  });

  function artistTracks(artist: string): Track[] {
    return ctx.library
      .tracks()
      .filter((track) => track.artist === artist)
      .sort(
        (a, b) =>
          a.album.localeCompare(b.album, undefined, { sensitivity: "base" }) ||
          (a.discNo ?? 1) - (b.discNo ?? 1) ||
          (a.trackNo ?? 0) - (b.trackNo ?? 0),
      );
  }

  function createArtistRow(artist: { artist: string; albumCount: number; tracks: Track[]; coverId?: string }, currentGeneration: number): HTMLElement {
    const avatar = document.createElement("cz-cover") as unknown as CoverElement;
    avatar.seed = artist.artist;
    avatar.size = 46;
    avatar.src = null;
    if (artist.coverId) {
      void resolveCover(ctx.bridge, artist.coverId).then((url) => {
        if (!destroyed && currentGeneration === generation && url) avatar.src = url;
      });
    }

    const open = (): void => ctx.actions.setFilter({ kind: "artist", artist: artist.artist });

    return h(
      "div",
      {
        class: "artist-row",
        role: "button",
        tabIndex: 0,
        aria: { label: `Open artist ${artist.artist}` },
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
      h("div", { class: "artist-row__avatar" }, avatar),
      h(
        "div",
        { class: "artist-row__text" },
        h("p", { class: "artist-row__name", text: artist.artist }),
        h(
          "p",
          {
            class: "artist-row__meta",
            text: `${describeCount(artist.albumCount, "album")} | ${describeCount(artist.tracks.length, "track")}`,
          },
        ),
      ),
      h("span", { class: "artist-row__go" }, icon("chevron-right", 17)),
    );
  }

  function update(state: AppState): void {
    generation += 1;
    const currentGeneration = generation;
    const filter = state.filter;

    if (filter && filter.kind === "artist") {
      const tracks = artistTracks(filter.artist);
      listEl.hidden = true;
      emptyWrap.hidden = true;
      filterBar.hidden = false;
      trackList.hidden = false;
      trackList.tracks = tracks;
      trackList.currentId = ctx.player.snapshot.track?.id ?? null;
      trackList.playing = ctx.player.snapshot.state === "playing";
      filterChip.replaceChildren(
        h("span", {}, "Artist: ", h("strong", { text: filter.artist })),
        h(
          "button",
          {
            class: "filter-clear",
            type: "button",
            aria: { label: "Back to all artists" },
            on: { click: () => ctx.actions.setFilter(null) },
          },
          icon("close", 13),
        ),
      );
      return;
    }

    filterBar.hidden = true;
    trackList.hidden = true;
    const artists = artistViews(visibleTracks(state));
    listEl.replaceChildren(...artists.map((artist) => createArtistRow(artist, currentGeneration)));
    listEl.hidden = artists.length === 0;
    emptyWrap.hidden = artists.length > 0;
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

function detailOf<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent)) return null;
  return (event.detail as T | null) ?? null;
}
