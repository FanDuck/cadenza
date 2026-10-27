/**
 * Playlists view: local playlists plus import/export through the host bridge.
 *
 * Playlists are stored through the same settings store as everything else, so
 * they survive restarts in Electron and page reloads in the browser demo.
 */

import { h, icon, on } from "../dom.js";
import {
  createPlaylist,
  getState,
  setState,
  writePlaylists,
  type AppState,
  type SavedPlaylist,
  type TrackListElement,
  type UiContext,
  type ViewPart,
} from "../state.js";
import type { Track } from "@fanduck/cadenza-core";

interface EmptyStateElement extends HTMLElement {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
}

export function createPlaylistsView(ctx: UiContext): ViewPart {
  /* ------------------------------------------------------------- toolbar */

  const hint = h("span", { class: "view-hint", text: "" });

  const newButton = h(
    "button",
    {
      class: "primary-btn",
      type: "button",
      aria: { label: "Create a new playlist" },
      on: { click: () => createNew() },
    },
    icon("plus", 15),
    h("span", { text: "New playlist" }),
  );

  const importButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Import a playlist file (m3u or pls)" },
      on: { click: () => void importPlaylist() },
    },
    icon("folder", 15),
    h("span", { text: "Import" }),
  );

  const exportButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Export the current queue as a playlist file" },
      on: { click: () => void exportQueue() },
    },
    icon("external", 15),
    h("span", { text: "Export queue" }),
  );

  const toolbar = h(
    "div",
    { class: "view-actions" },
    hint,
    h("div", { class: "view-actions__spacer" }),
    importButton,
    exportButton,
    newButton,
  );

  /* ------------------------------------------------------------ empty state */

  const empty = document.createElement("cz-empty-state") as unknown as EmptyStateElement;
  empty.icon = "playlist";
  empty.title = "No playlists yet";
  empty.description = "Group tracks into playlists, or import an .m3u / .pls file you already have.";
  empty.actionLabel = "New playlist";
  empty.addEventListener("cz-action", () => createNew());
  const emptyWrap = h("div", { class: "empty-wrap" }, empty);

  /* ---------------------------------------------------------------- lists */

  const playlistList = h("div", { class: "playlist-list" });

  const detailBack = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Back to all playlists" },
      on: { click: () => selectPlaylist(null) },
    },
    icon("chevron-left", 15),
    h("span", { text: "All playlists" }),
  );
  const detailTitle = h("h2", { class: "view-title", style: "font-size:20px" });
  const detailMeta = h("span", { class: "view-hint", text: "" });
  const detailPlay = h(
    "button",
    {
      class: "primary-btn",
      type: "button",
      aria: { label: "Play this playlist" },
      on: { click: () => playSelected() },
    },
    icon("play", 14),
    h("span", { text: "Play all" }),
  );
  const detailHead = h(
    "div",
    { class: "playlist-detail__head" },
    detailBack,
    detailTitle,
    detailMeta,
    h("div", { class: "view-actions__spacer" }),
    detailPlay,
  );

  const trackList = document.createElement("cz-track-list") as unknown as TrackListElement;
  trackList.variant = "full";
  trackList.showHeader = false;
  trackList.emptyText = "This playlist is empty";
  trackList.tracks = [];
  trackList.currentId = null;
  trackList.playing = false;
  trackList.hidden = true;

  const detail = h("div", { class: "view" }, detailHead, trackList);
  detail.hidden = true;

  const el = h("div", { class: "view" }, toolbar, emptyWrap, playlistList, detail);

  /* -------------------------------------------------------------- view state */

  let selectedId: string | null = null;
  let editingId: string | null = null;
  let pendingDeleteId: string | null = null;
  let pendingDeleteTimer: number | null = null;
  let busy = false;

  /* ---------------------------------------------------------------- helpers */

  function playlists(): SavedPlaylist[] {
    return getState().playlists;
  }

  function saveAll(next: SavedPlaylist[]): void {
    setState({ playlists: next });
    writePlaylists(ctx.store, next);
  }

  function playlistTracks(playlist: SavedPlaylist): Track[] {
    const byId = new Map(getState().tracks.map((track) => [track.id, track]));
    return playlist.trackIds
      .map((id) => byId.get(id))
      .filter((track): track is Track => track !== undefined);
  }

  function createNew(): void {
    const next = [...playlists(), createPlaylist(`New playlist ${playlists().length + 1}`, [])];
    const created = next[next.length - 1];
    if (!created) return;
    saveAll(next);
    selectedId = created.id;
    editingId = created.id;
    update(getState());
    focusEditor();
  }

  async function importPlaylist(): Promise<void> {
    if (busy) return;
    busy = true;
    importButton.disabled = true;
    try {
      const filePath = await ctx.bridge.dialog.pickPlaylist();
      if (!filePath) return;
      const file = await ctx.bridge.playlists.import(filePath);
      if (!file) {
        ctx.actions.toast("Could not read that playlist file", "error");
        return;
      }
      const byPath = new Map(getState().tracks.map((track) => [track.path, track]));
      const trackIds: string[] = [];
      for (const entry of file.entries) {
        const track = byPath.get(entry.path);
        if (track && !trackIds.includes(track.id)) trackIds.push(track.id);
      }
      const playlist = createPlaylist(file.name, trackIds);
      saveAll([...playlists(), playlist]);
      selectedId = playlist.id;
      update(getState());
      ctx.actions.toast(`Imported "${file.name}" (${trackIds.length} tracks)`, "success");
    } catch (error) {
      console.error("Cadenza: playlist import failed", error);
      ctx.actions.toast("Playlist import failed", "error");
    } finally {
      busy = false;
      importButton.disabled = false;
    }
  }

  async function exportQueue(): Promise<void> {
    if (busy) return;
    const queue = ctx.player.queue;
    if (queue.items.length === 0) {
      ctx.actions.toast("The queue is empty - nothing to export", "error");
      return;
    }
    busy = true;
    exportButton.disabled = true;
    try {
      const name = `Cadenza queue ${new Date().toISOString().slice(0, 10)}`;
      const savedTo = await ctx.bridge.playlists.export(name, queue.items.map((track) => track.path));
      if (savedTo) ctx.actions.toast(`Queue exported to ${savedTo}`, "success");
    } catch (error) {
      console.error("Cadenza: playlist export failed", error);
      ctx.actions.toast("Playlist export failed", "error");
    } finally {
      busy = false;
      exportButton.disabled = false;
    }
  }

  function selectPlaylist(id: string | null): void {
    selectedId = id;
    editingId = null;
    pendingDeleteId = null;
    update(getState());
  }

  function startRename(playlist: SavedPlaylist): void {
    editingId = playlist.id;
    update(getState());
    focusEditor();
  }

  function focusEditor(): void {
    // The rename input is created by update(); focus after it lands in the DOM.
    queueMicrotask(() => {
      const input = el.querySelector<HTMLInputElement>(".playlist-name-input");
      input?.focus();
      input?.select();
    });
  }

  function commitRename(playlist: SavedPlaylist, value: string): void {
    const name = value.trim();
    editingId = null;
    if (name.length === 0 || name === playlist.name) {
      update(getState());
      return;
    }
    saveAll(playlists().map((item) => (item.id === playlist.id ? { ...item, name } : item)));
    update(getState());
  }

  function deletePlaylist(playlist: SavedPlaylist): void {
    if (pendingDeleteId !== playlist.id) {
      pendingDeleteId = playlist.id;
      if (pendingDeleteTimer !== null) window.clearTimeout(pendingDeleteTimer);
      pendingDeleteTimer = window.setTimeout(() => {
        pendingDeleteId = null;
        update(getState());
      }, 4000);
      update(getState());
      return;
    }
    if (pendingDeleteTimer !== null) window.clearTimeout(pendingDeleteTimer);
    pendingDeleteTimer = null;
    pendingDeleteId = null;
    if (selectedId === playlist.id) selectedId = null;
    saveAll(playlists().filter((item) => item.id !== playlist.id));
    update(getState());
    ctx.actions.toast(`Deleted playlist "${playlist.name}"`, "success");
  }

  function playSelected(): void {
    const playlist = playlists().find((item) => item.id === selectedId);
    if (!playlist) return;
    const tracks = playlistTracks(playlist);
    if (tracks.length === 0) {
      ctx.actions.toast("This playlist has no tracks from your library yet", "info");
      return;
    }
    ctx.actions.playTracks(tracks);
  }

  /* ---------------------------------------------------------------- rendering */

  function renderRow(playlist: SavedPlaylist): HTMLElement {
    const tracks = playlistTracks(playlist);
    const isEditing = editingId === playlist.id;

    const name: HTMLElement = isEditing
      ? h("input", {
          class: "playlist-name-input",
          type: "text",
          value: playlist.name,
          aria: { label: `Rename playlist ${playlist.name}` },
          on: {
            keydown: (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename(playlist, (event.target as HTMLInputElement).value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                editingId = null;
                update(getState());
              }
            },
            blur: (event) => {
              if (editingId === playlist.id) commitRename(playlist, (event.target as HTMLInputElement).value);
            },
          },
        })
      : h("p", { class: "playlist-row__name", text: playlist.name });

    const deleteLabel = pendingDeleteId === playlist.id ? "Confirm delete" : `Delete playlist ${playlist.name}`;

    return h(
      "div",
      {
        class: playlist.id === selectedId ? "playlist-row playlist-row--active" : "playlist-row",
        dataset: { playlistId: playlist.id },
        on: { click: () => selectPlaylist(playlist.id) },
      },
      h("span", { class: "playlist-row__art" }, icon("playlists", 20)),
      h(
        "div",
        { class: "playlist-row__text" },
        name,
        h(
          "p",
          {
            class: "playlist-row__meta",
            text: `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} | created ${new Date(playlist.createdAt).toLocaleDateString()}`,
          },
        ),
      ),
      h(
        "div",
        { class: "playlist-row__actions" },
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            aria: { label: `Play playlist ${playlist.name}` },
            on: {
              click: (event) => {
                event.stopPropagation();
                const list = playlistTracks(playlist);
                if (list.length > 0) ctx.actions.playTracks(list);
              },
            },
          },
          icon("play", 15),
        ),
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            aria: { label: `Rename playlist ${playlist.name}` },
            on: {
              click: (event) => {
                event.stopPropagation();
                startRename(playlist);
              },
            },
          },
          icon("edit", 15),
        ),
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            aria: { label: deleteLabel },
            on: {
              click: (event) => {
                event.stopPropagation();
                deletePlaylist(playlist);
              },
            },
          },
          icon("trash", 15),
        ),
      ),
    );
  }

  function update(state: AppState): void {
    const items = playlists();
    const query = state.query.trim().toLowerCase();
    const visibleItems = query.length === 0 ? items : items.filter((playlist) => playlist.name.toLowerCase().includes(query));

    hint.textContent =
      query.length > 0 && items.length > 0
        ? `${visibleItems.length} of ${items.length} playlists match`
        : `${items.length} ${items.length === 1 ? "playlist" : "playlists"} | stored locally`;

    emptyWrap.hidden = items.length > 0 || selectedId !== null;
    playlistList.replaceChildren(...visibleItems.map((playlist) => renderRow(playlist)));
    playlistList.hidden = selectedId !== null || visibleItems.length === 0;

    const selected = items.find((item) => item.id === selectedId) ?? null;
    detail.hidden = selected === null;
    if (selected) {
      detailTitle.textContent = selected.name;
      const tracks = playlistTracks(selected);
      detailMeta.textContent = `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`;
      detailPlay.disabled = tracks.length === 0;
      trackList.hidden = false;
      trackList.tracks = tracks;
      trackList.currentId = ctx.player.snapshot.track?.id ?? null;
      trackList.playing = ctx.player.snapshot.state === "playing";
    }
  }

  /* ---------------------------------------------------------------- events */

  trackList.addEventListener("cz-activate", ((event: Event) => {
    const detailData = detailOf<{ index: number }>(event);
    const selected = playlists().find((item) => item.id === selectedId);
    if (!detailData || !selected) return;
    const tracks = playlistTracks(selected);
    ctx.actions.playTracks(tracks, detailData.index);
  }) as EventListener);

  trackList.addEventListener("cz-menu", ((event: Event) => {
    const detailData = detailOf<{ track: Track; x: number; y: number }>(event);
    if (!detailData) return;
    ctx.actions.showTrackMenu(detailData.track, detailData.x, detailData.y);
  }) as EventListener);

  const unsubscribePlayer = ctx.player.onSnapshot((snapshot) => {
    trackList.currentId = snapshot.track?.id ?? null;
    trackList.playing = snapshot.state === "playing";
  });

  /** Clicking anywhere else cancels the delete confirmation / rename. */
  on(el, "click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (pendingDeleteId !== null && !target.closest(".playlist-row__actions")) {
      pendingDeleteId = null;
      window.setTimeout(() => update(getState()), 0);
    }
  });

  return {
    el,
    update,
    destroy(): void {
      unsubscribePlayer();
      if (pendingDeleteTimer !== null) window.clearTimeout(pendingDeleteTimer);
    },
  };
}

function detailOf<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent)) return null;
  return (event.detail as T | null) ?? null;
}
