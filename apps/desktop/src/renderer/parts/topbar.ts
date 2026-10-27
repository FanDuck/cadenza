/**
 * View header: big title, live counts, transport buttons, sort menu, search.
 */

import { h, icon, on, setText } from "../dom.js";
import {
  albumViews,
  artistViews,
  describeCount,
  describeDuration,
  getState,
  visibleTracks,
  type AppState,
  type UiContext,
  type ViewPart,
} from "../state.js";
import type { SortKey } from "@fanduck/cadenza-core";

export interface TopbarPart extends ViewPart {
  focusSearch(): void;
}

const SORT_LABELS: Record<SortKey, string> = {
  title: "Title",
  artist: "Artist",
  album: "Album",
  albumArtist: "Album artist",
  added: "Date added",
  duration: "Duration",
  year: "Year",
};

const SORT_KEYS: readonly SortKey[] = ["artist", "title", "album", "added", "duration", "year"];

export function createTopbar(ctx: UiContext): TopbarPart {
  const title = h("h1", { class: "view-title", text: "Library" });
  const subtitle = h("p", { class: "view-subtitle", text: "" });
  const head = h("div", { class: "view-header__head" }, title, subtitle);

  const playAllButton = h(
    "button",
    {
      class: "primary-btn",
      type: "button",
      aria: { label: "Play all visible tracks" },
      on: { click: () => ctx.actions.playTracks(visibleTracks()) },
    },
    icon("play", 14),
    h("span", { text: "Play all" }),
  );

  const shuffleButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Shuffle all visible tracks" },
      on: { click: () => ctx.actions.shuffleTracks(visibleTracks()) },
    },
    icon("shuffle", 14),
    h("span", { text: "Shuffle" }),
  );

  /* ------------------------------------------------------------- sort menu */

  const sortLabelText = h("span", { text: SORT_LABELS.artist });
  const sortButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { haspopup: "menu", expanded: "false", label: "Sort tracks" },
      on: { click: () => toggleSortMenu() },
    },
    icon("sort", 14),
    sortLabelText,
    icon("chevron-down", 13),
  );
  const sortMenu = h("div", { class: "sort-menu", role: "menu", aria: { label: "Sort tracks" } });
  sortMenu.hidden = true;
  const sortWrap = h("div", { class: "sort-wrap" }, sortButton, sortMenu);

  let sortMenuOpen = false;

  function closeSortMenu(): void {
    if (!sortMenuOpen) return;
    sortMenuOpen = false;
    sortMenu.hidden = true;
    sortButton.setAttribute("aria-expanded", "false");
  }

  function toggleSortMenu(): void {
    if (sortMenuOpen) {
      closeSortMenu();
      return;
    }
    renderSortMenu();
    sortMenu.hidden = false;
    sortMenuOpen = true;
    sortButton.setAttribute("aria-expanded", "true");
    const first = sortMenu.querySelector<HTMLButtonElement>("button");
    first?.focus();
  }

  function renderSortMenu(): void {
    const state = getState();
    sortMenu.replaceChildren();
    for (const key of SORT_KEYS) {
      const checked = state.sort.key === key;
      const arrow = checked ? (state.sort.dir === "asc" ? " Up" : " Down") : "";
      const item = h(
        "button",
        {
          class: "sort-item",
          type: "button",
          role: "menuitemradio",
          aria: { checked: checked ? "true" : "false" },
          on: {
            click: () => {
              ctx.actions.setSort(key);
              closeSortMenu();
              sortButton.focus();
            },
          },
        },
        h("span", { text: `${SORT_LABELS[key]}${arrow}` }),
      );
      sortMenu.append(item);
    }
    sortMenu.append(h("div", { class: "context-menu__sep" }));
    sortMenu.append(
      h(
        "button",
        {
          class: "sort-item",
          type: "button",
          role: "menuitem",
          on: {
            click: () => {
              ctx.actions.toggleSortDirection();
              closeSortMenu();
              sortButton.focus();
            },
          },
        },
        h("span", { text: state.sort.dir === "asc" ? "Descending" : "Ascending" }),
        h("span", { class: "context-menu__shortcut", text: state.sort.dir === "asc" ? "Down" : "Up" }),
      ),
    );
  }

  on(document, "pointerdown", (event) => {
    if (!sortMenuOpen) return;
    const target = event.target;
    if (target instanceof Node && sortWrap.contains(target)) return;
    closeSortMenu();
  }, true);

  on(document, "keydown", (event) => {
    if (!sortMenuOpen) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      closeSortMenu();
      sortButton.focus();
    }
  }, true);

  /* --------------------------------------------------------------- search */

  const searchInput = h("input", {
    class: "search-input",
    type: "search",
    placeholder: "Search music",
    aria: { label: "Search music" },
    attrs: { spellcheck: "false", autocomplete: "off" },
    on: {
      input: () => ctx.actions.setQuery(searchInput.value),
      keydown: (event) => {
        if (event.key === "Escape") {
          searchInput.value = "";
          ctx.actions.setQuery("");
          searchInput.blur();
          event.stopPropagation();
        }
      },
    },
  });
  const searchField = h(
    "div",
    { class: "search-field", on: { click: () => searchInput.focus() } },
    icon("search", 16),
    searchInput,
    h("span", { class: "kbd", text: "Ctrl F" }),
  );

  const actions = h(
    "div",
    { class: "view-header__actions" },
    playAllButton,
    shuffleButton,
    sortWrap,
    searchField,
  );

  const el = h("header", { class: "view-header" }, head, actions);

  function update(state: AppState): void {
    const info = describeView(state, ctx);
    setText(title, info.title);
    setText(subtitle, info.subtitle);

    const transportViews = state.view === "library" || state.view === "albums" || state.view === "artists";
    playAllButton.hidden = !transportViews;
    shuffleButton.hidden = !transportViews;
    sortWrap.hidden = !transportViews;
    searchField.hidden = state.view === "settings";

    const tracks = visibleTracks(state);
    playAllButton.disabled = tracks.length === 0;
    shuffleButton.disabled = tracks.length === 0;

    setText(sortLabelText, SORT_LABELS[state.sort.key]);
    sortButton.setAttribute(
      "aria-label",
      `Sort tracks, currently by ${SORT_LABELS[state.sort.key].toLowerCase()}, ${state.sort.dir === "asc" ? "ascending" : "descending"}`,
    );

    if (document.activeElement !== searchInput && searchInput.value !== state.query) {
      searchInput.value = state.query;
    }
    searchInput.placeholder = state.view === "albums" ? "Search albums" : state.view === "artists" ? "Search artists" : "Search music";
    searchInput.setAttribute("aria-label", searchInput.placeholder);
  }

  return {
    el,
    update,
    focusSearch(): void {
      searchInput.focus();
      searchInput.select();
    },
  };
}

function describeView(state: AppState, ctx: UiContext): { title: string; subtitle: string } {
  const tracks = visibleTracks(state);
  const totalSeconds = tracks.reduce((sum, track) => sum + track.duration, 0);
  const filtered = state.query.trim().length > 0 || state.filter !== null;
  const suffix = filtered ? ` of ${state.tracks.length}` : "";

  switch (state.view) {
    case "albums": {
      const albums = albumViews(tracks);
      return {
        title: "Albums",
        subtitle: `${describeCount(albums.length, "album")} | ${describeCount(tracks.length, "song")}`,
      };
    }
    case "artists": {
      const artists = artistViews(tracks);
      return {
        title: "Artists",
        subtitle: `${describeCount(artists.length, "artist")} | ${describeCount(tracks.length, "song")}`,
      };
    }
    case "playlists":
      return {
        title: "Playlists",
        subtitle: `${describeCount(state.playlists.length, "playlist")} | stored on this device`,
      };
    case "settings":
      return {
        title: "Settings",
        subtitle: `Cadenza ${ctx.actions.version()}${ctx.bridge.demo ? " | browser demo" : ""}`,
      };
    case "now-playing":
      return { title: "Now playing", subtitle: "" };
    case "library":
    default:
      return {
        title: "Library",
        subtitle: `${tracks.length}${suffix} songs | ${describeDuration(totalSeconds)}`,
      };
  }
}
