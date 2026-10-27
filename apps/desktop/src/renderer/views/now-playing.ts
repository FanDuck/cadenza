/**
 * Full-page Now playing view: big cover, blurred backdrop, visualizer and the
 * Lyrics / Queue tabs.
 */

import { h, icon, on, setText } from "../dom.js";
import { resolveCover, type AppState, type TrackListElement, type UiContext, type ViewPart } from "../state.js";
import type { LyricsDoc, PlayerSnapshot, QueueState, Track } from "@fanduck/cadenza-core";

interface CoverElement extends HTMLElement {
  src: string | null;
  seed: string;
  size: number;
}

interface VisualizerElement extends HTMLElement {
  analyser: AnalyserNode | null;
  playing: boolean;
  bars: number;
  height: number;
}

interface LyricsElement extends HTMLElement {
  doc: LyricsDoc | null;
  position: number;
  title: string;
}

interface EmptyStateElement extends HTMLElement {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
}

type TabId = "lyrics" | "queue";

export function createNowPlayingView(ctx: UiContext): ViewPart {
  /* ---------------------------------------------------------------- hero */

  const cover = document.createElement("cz-cover") as unknown as CoverElement;
  cover.size = 280;
  cover.seed = "Cadenza";
  cover.src = null;
  cover.className = "np-cover";

  const coverWrap = h("div", { class: "np-cover-wrap" }, cover);
  const backdrop = h("div", { class: "np-backdrop", attrs: { "aria-hidden": "true" } });

  // `<cz-cover>` is sized in pixels, so keep it in sync with the responsive slot.
  let coverObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    coverObserver = new ResizeObserver(() => {
      const width = coverWrap.clientWidth;
      if (width > 0) cover.size = Math.max(160, Math.min(320, Math.round(width)));
    });
    coverObserver.observe(coverWrap);
  }

  const eyebrow = h("p", { class: "np-eyebrow", text: "Now playing" });
  const title = h("h1", { class: "np-title", text: "Nothing playing" });
  const artist = h("p", { class: "np-artist", text: "" });
  const album = h("p", { class: "np-album", text: "Pick a track from your library to start" });

  const prevButton = h(
    "button",
    { class: "icon-btn", type: "button", aria: { label: "Previous track" }, on: { click: () => ctx.player.previous() } },
    icon("previous", 17),
  );
  const playButton = h(
    "button",
    { class: "icon-btn", type: "button", aria: { label: "Play" }, on: { click: () => ctx.player.toggle() } },
    icon("play", 17),
  );
  const nextButton = h(
    "button",
    { class: "icon-btn", type: "button", aria: { label: "Next track" }, on: { click: () => ctx.player.next() } },
    icon("next", 17),
  );

  const queueToggle = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Toggle the queue panel", pressed: "false" },
      on: { click: () => ctx.actions.toggleQueue() },
    },
    icon("queue", 15),
    h("span", { text: "Queue" }),
  );

  const actionSlot = h("div", { class: "np-actions__slot", dataset: { slot: "now-playing:action" } });

  const visualizer = document.createElement("cz-visualizer") as unknown as VisualizerElement;
  visualizer.bars = 48;
  visualizer.height = 64;
  visualizer.analyser = null;
  visualizer.playing = false;
  visualizer.className = "np-visualizer";

  const hero = h(
    "section",
    { class: "np-hero", attrs: { "aria-label": "Now playing" } },
    coverWrap,
    h(
      "div",
      { class: "np-info" },
      eyebrow,
      title,
      artist,
      album,
      visualizer,
      h("div", { class: "np-actions" }, prevButton, playButton, nextButton, queueToggle, actionSlot),
    ),
  );

  /* ---------------------------------------------------------------- tabs */

  const lyricsTab = tabButton("lyrics", "Lyrics");
  const queueTab = tabButton("queue", "Queue");
  const tabList = h("div", { class: "np-tabs", role: "tablist", aria: { label: "Now playing panes" } }, lyricsTab, queueTab);

  /* -------------------------------------------------------------- lyrics */

  const lyrics = document.createElement("cz-lyrics") as unknown as LyricsElement;
  lyrics.doc = null;
  lyrics.position = 0;
  lyrics.title = "";
  lyrics.className = "np-lyrics";
  lyrics.id = "cz-lyrics-panel";

  const lyricsEmpty = document.createElement("cz-empty-state") as unknown as EmptyStateElement;
  lyricsEmpty.icon = "lyrics";
  lyricsEmpty.title = "No lyrics for this track";
  lyricsEmpty.description = "Cadenza looks for an .lrc file next to the audio file, or a plugin that provides lyrics.";
  lyricsEmpty.actionLabel = "";
  lyricsEmpty.hidden = true;

  const lyricsPanel = h(
    "section",
    { class: "np-panel", role: "tabpanel", id: "cz-now-lyrics", aria: { labelledby: "cz-tab-lyrics" } },
    lyrics,
    lyricsEmpty,
  );

  /* --------------------------------------------------------------- queue */

  const queueList = document.createElement("cz-track-list") as unknown as TrackListElement;
  queueList.variant = "compact";
  queueList.showHeader = false;
  queueList.emptyText = "The queue is empty";
  queueList.tracks = [];
  queueList.currentId = null;
  queueList.playing = false;

  queueList.addEventListener("cz-activate", ((event: Event) => {
    const detail = detailOf<{ track: Track; index: number }>(event);
    if (!detail) return;
    ctx.actions.playTracks(ctx.player.queue.items, detail.index);
  }) as EventListener);

  queueList.addEventListener("cz-menu", ((event: Event) => {
    const detail = detailOf<{ track: Track; x: number; y: number }>(event);
    if (!detail) return;
    ctx.actions.showTrackMenu(detail.track, detail.x, detail.y);
  }) as EventListener);

  const queuePanel = h(
    "section",
    { class: "np-panel np-queue", role: "tabpanel", id: "cz-now-queue", aria: { labelledby: "cz-tab-queue" } },
    queueList,
  );
  queuePanel.hidden = true;

  /* --------------------------------------------------------------- shell */

  const backButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Back to the library" },
      on: { click: () => ctx.actions.navigate("library") },
    },
    icon("chevron-left", 15),
    h("span", { text: "Library" }),
  );

  const el = h(
    "div",
    { class: "now-playing" },
    backdrop,
    h(
      "div",
      { class: "np-scroll" },
      h("div", { class: "view-actions" }, backButton),
      hero,
      tabList,
      lyricsPanel,
      queuePanel,
    ),
  );

  let activeTab: TabId = "lyrics";
  let currentTrackId: string | null = null;
  let lyricsRequest = 0;
  const lyricsCache = new Map<string, LyricsDoc | null>();

  function tabButton(id: TabId, label: string): HTMLButtonElement {
    return h(
      "button",
      {
        class: "np-tab",
        type: "button",
        role: "tab",
        id: `cz-tab-${id}`,
        aria: { selected: "false", controls: `cz-now-${id}` },
        on: { click: () => setTab(id) },
      },
      h("span", { text: label }),
    );
  }

  function setTab(id: TabId): void {
    activeTab = id;
    for (const [tabId, button] of [["lyrics", lyricsTab], ["queue", queueTab]] as const) {
      const selected = tabId === id;
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
    lyricsPanel.hidden = id !== "lyrics";
    queuePanel.hidden = id !== "queue";
  }

  setTab("lyrics");

  tabList.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: TabId = activeTab === "lyrics" ? "queue" : "lyrics";
    setTab(next);
    (next === "lyrics" ? lyricsTab : queueTab).focus();
  });

  /* -------------------------------------------------------------- helpers */

  async function loadTrackDetails(track: Track | null): Promise<void> {
    if (!track) {
      cover.src = null;
      cover.seed = "Cadenza";
      backdrop.style.backgroundImage = "";
      lyricsEmpty.title = "Nothing playing";
      lyrics.doc = null;
      lyricsEmpty.hidden = false;
      lyrics.hidden = true;
      return;
    }

    cover.seed = `${track.artist} | ${track.album}`;
    lyrics.title = track.title;

    const request = (lyricsRequest += 1);

    const coverUrl = await resolveCover(ctx.bridge, track.coverId);
    if (request !== lyricsRequest) return;
    cover.src = coverUrl;
    if (coverUrl) backdrop.style.backgroundImage = `url(${JSON.stringify(coverUrl)})`;
    else backdrop.style.backgroundImage = "";

    let doc = lyricsCache.get(track.path) ?? null;
    if (!lyricsCache.has(track.path)) {
      try {
        doc = await ctx.bridge.lyrics.for(track.path);
      } catch (error) {
        console.warn("Cadenza: could not load lyrics", error);
        doc = null;
      }
      lyricsCache.set(track.path, doc);
    }
    if (request !== lyricsRequest) return;

    lyrics.doc = doc;
    lyrics.hidden = doc === null;
    lyricsEmpty.hidden = doc !== null;
    if (doc === null) {
      lyricsEmpty.title = "No lyrics for this track";
      lyricsEmpty.description = "Cadenza looks for an .lrc file next to the audio file, or a plugin that provides lyrics.";
    }
  }

  function applySnapshot(snapshot: PlayerSnapshot): void {
    const track = snapshot.track;
    setText(title, track?.title ?? "Nothing playing");
    setText(artist, track?.artist ?? "");
    setText(
      album,
      track ? `${track.album}${track.year ? ` | ${track.year}` : ""}${track.codec ? ` | ${track.codec}` : ""}` : "Pick a track from your library to start",
    );

    const playing = snapshot.state === "playing";
    playButton.replaceChildren(icon(playing ? "pause" : "play", 17));
    playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
    playButton.disabled = snapshot.track === null;

    visualizer.playing = playing;
    visualizer.analyser = ctx.actions.getAnalyser();
    lyrics.position = snapshot.position;

    queueList.currentId = track?.id ?? null;
    queueList.playing = playing;

    if ((track?.id ?? null) !== currentTrackId) {
      currentTrackId = track?.id ?? null;
      void loadTrackDetails(track);
    }
  }

  function renderQueue(queue: QueueState): void {
    queueList.tracks = [...queue.items];
  }

  const unsubscribePlayer = ctx.player.onSnapshot(applySnapshot);
  const unsubscribeQueue = ctx.player.onQueueChange(renderQueue);

  // The analyser can only be created on a user gesture; the first click in this
  // view is a good moment to try.
  const stopListening = on(el, "pointerdown", () => {
    const analyser = ctx.actions.ensureAudio();
    if (analyser) visualizer.analyser = analyser;
  });

  renderQueue(ctx.player.queue);
  applySnapshot(ctx.player.snapshot);

  return {
    el,
    update(state: AppState): void {
      queueToggle.setAttribute("aria-pressed", state.queueOpen ? "true" : "false");
    },
    destroy(): void {
      unsubscribePlayer();
      unsubscribeQueue();
      stopListening();
      coverObserver?.disconnect();
      coverObserver = null;
    },
  };
}

function detailOf<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent)) return null;
  return (event.detail as T | null) ?? null;
}
