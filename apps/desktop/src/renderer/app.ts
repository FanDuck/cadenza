/**
 * The app shell.
 *
 * `App` owns the window chrome, the four permanent parts (sidebar, view header,
 * queue, player bar), the overlays (palette, context menu, toasts) and the
 * mounted view. It also implements `AppActions`, the command surface every view
 * and part calls into, and the global keyboard map.
 *
 * Bootstrapping happens in `main.ts`; this file assumes services already exist.
 */

import { duckGlyph, h, icon, on } from "./dom.js";
import { applyTheme as applyThemeVars, THEMES } from "./themes.js";
import {
  getState,
  pushToast,
  setState,
  subscribe,
  type AppActions,
  type AppServices,
  type AppState,
  type MenuEntry,
  type SettingsSection,
  type UiContext,
  type ViewId,
  type ViewPart,
} from "./state.js";
import type { Command, PlayerSnapshot, SortKey, Track } from "@fanduck/cadenza-core";
import { createContextMenu, type ContextMenuPart } from "./parts/context-menu.js";
import { createPalette, type PalettePart } from "./parts/command-palette.js";
import { createPlayerBar } from "./parts/player-bar.js";
import { createQueuePanel } from "./parts/queue-panel.js";
import { createSidebar } from "./parts/sidebar.js";
import { createTopbar, type TopbarPart } from "./parts/topbar.js";
import { createAlbumsView } from "./views/albums.js";
import { createArtistsView } from "./views/artists.js";
import { createLibraryView } from "./views/library.js";
import { createNowPlayingView } from "./views/now-playing.js";
import { createPlaylistsView } from "./views/playlists.js";
import { createSettingsView } from "./views/settings.js";

/** The subset of `<cz-toast-host>` we use. */
interface ToastHostElement extends HTMLElement {
  show(message: string, kind: "info" | "success" | "error", durationMs?: number): void;
  dismissAll?(): void;
}

const VIEW_FACTORIES: Record<ViewId, (ctx: UiContext) => ViewPart> = {
  library: createLibraryView,
  albums: createAlbumsView,
  artists: createArtistsView,
  playlists: createPlaylistsView,
  settings: createSettingsView,
  "now-playing": createNowPlayingView,
};

const REPEAT_ORDER = ["off", "all", "one"] as const;

export class App implements AppActions {
  private readonly root: HTMLElement;
  private readonly services: AppServices;
  private readonly ctx: UiContext;

  private readonly sidebar: ViewPart;
  private readonly topbar: TopbarPart;
  private readonly queuePanel: ViewPart;
  private readonly playerBar: ViewPart;
  private readonly palette: PalettePart;
  private readonly menu: ContextMenuPart;
  private readonly viewHost: HTMLElement;
  private readonly toastHost: ToastHostElement;

  private mountedView: ViewId | null = null;
  private mountedPart: ViewPart | null = null;
  private pendingSettingsSection: SettingsSection | null = null;
  private readonly shownToasts = new Set<number>();
  private readonly cleanup: Array<() => void> = [];

  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(root: HTMLElement, services: AppServices) {
    this.root = root;
    this.services = services;
    this.ctx = {
      ...services,
      actions: this,
      commands: [...services.commands, ...this.createCommands()],
    };

    this.sidebar = createSidebar(this.ctx);
    this.topbar = createTopbar(this.ctx);
    this.queuePanel = createQueuePanel(this.ctx);
    this.playerBar = createPlayerBar(this.ctx);
    this.palette = createPalette(this.ctx);
    this.menu = createContextMenu(this.ctx);
    this.viewHost = h("div", { class: "view-content", id: "cz-view-host", attrs: { "aria-label": "Content" } });
    this.toastHost = document.createElement("cz-toast-host") as unknown as ToastHostElement;
  }

  /* ---------------------------------------------------------------- mount */

  mount(): void {
    applyThemeVars(getState().settings.theme, getState().settings.accent);

    this.root.classList.add("app");
    this.root.replaceChildren(
      this.buildTitlebar(),
      h("div", { class: "workspace" }, this.sidebar.el, this.buildMain(), this.queuePanel.el),
      this.playerBar.el,
      this.palette.el,
      this.menu.el,
      this.toastHost,
    );

    const unsubscribeState = subscribe((next, previous) => this.render(next, previous));
    this.cleanup.push(unsubscribeState);

    this.cleanup.push(on(document, "keydown", (event) => this.handleKeydown(event)));
    // WebAudio and the analyser may only start from a user gesture.
    this.cleanup.push(on(document, "pointerdown", () => void this.ensureAudio(), { once: true, capture: true }));
    this.cleanup.push(on(document, "keydown", () => void this.ensureAudio(), { once: true, capture: true }));

    // Host commands (media keys, tray / menu actions). Whether the OS-level
    // media keys are registered is the main process's decision (the `mediaKeys`
    // setting); the renderer always obeys commands that do arrive.
    this.cleanup.push(
      this.services.bridge.onCommand((command) => {
        switch (command) {
          case "play-pause":
            this.ctx.player.toggle();
            break;
          case "next":
            this.ctx.player.next();
            break;
          case "previous":
            this.ctx.player.previous();
            break;
          case "stop":
            this.ctx.player.stop();
            break;
          case "focus-search":
            this.focusSearch();
            break;
          case "open-settings":
            this.navigate("settings");
            break;
          case "toggle-queue":
            this.toggleQueue();
            break;
          default:
            console.warn("Cadenza: unknown host command", command);
        }
      }),
    );

    this.render(getState(), getState());
  }

  dispose(): void {
    this.playerBar.destroy?.();
    this.queuePanel.destroy?.();
    this.palette.destroy?.();
    this.mountedPart?.destroy?.();
    for (const cleanup of this.cleanup.splice(0)) cleanup();
    this.audioContext?.close().catch(() => undefined);
  }

  /* ------------------------------------------------------------- chrome */

  private buildMain(): HTMLElement {
    return h("main", { class: "main", attrs: { "aria-label": "Main content" } }, this.topbar.el, this.viewHost);
  }

  private buildTitlebar(): HTMLElement {
    const mark = h(
      "button",
      {
        class: "app-mark",
        type: "button",
        aria: { label: "Go to the library" },
        on: { click: () => this.navigate("library") },
      },
      duckGlyph(18),
    );

    const badge = this.services.bridge.demo ? h("span", { class: "titlebar__badge", text: "demo" }) : null;

    const left = h("div", { class: "titlebar__left" }, mark, h("span", { class: "wordmark", text: "Cadenza" }), badge);
    const drag = h("div", { class: "titlebar__drag", attrs: { "aria-hidden": "true" } });
    const right = h("div", { class: "titlebar__right" });

    if (!this.services.bridge.demo) {
      right.append(...this.buildWindowControls());
      drag.addEventListener("dblclick", () => {
        void this.services.bridge.window.toggleMaximize().catch((error: unknown) => console.warn("Cadenza: maximize failed", error));
      });
    }

    return h("header", { class: "titlebar" }, left, drag, right);
  }

  private buildWindowControls(): HTMLElement[] {
    const minimize = h(
      "button",
      {
        class: "window-btn",
        type: "button",
        aria: { label: "Minimize window" },
        on: {
          click: () => {
            void this.services.bridge.window.minimize().catch((error: unknown) => console.warn("Cadenza: minimize failed", error));
          },
        },
      },
      icon("minimize", 15),
    );

    const maximize = h(
      "button",
      {
        class: "window-btn",
        type: "button",
        aria: { label: "Maximize window" },
        on: {
          click: () => {
            void this.services.bridge.window.toggleMaximize().catch((error: unknown) => console.warn("Cadenza: maximize failed", error));
          },
        },
      },
      icon("maximize", 14),
    );

    const close = h(
      "button",
      {
        class: "window-btn window-btn--close",
        type: "button",
        aria: { label: "Close window" },
        on: {
          click: () => {
            void this.services.bridge.window.close().catch((error: unknown) => console.warn("Cadenza: close failed", error));
          },
        },
      },
      icon("close", 15),
    );

    const controls = h("div", { class: "window-controls" }, minimize, maximize, close);

    void this.services.bridge.window.isMaximized().then((maximized) => setMaximizeIcon(maximized)).catch(() => undefined);
    const unsubscribe = this.services.bridge.window.onMaximizedChange((maximized) => setMaximizeIcon(maximized));
    this.cleanup.push(unsubscribe);

    function setMaximizeIcon(maximized: boolean): void {
      maximize.replaceChildren(icon(maximized ? "restore" : "maximize", 14));
      maximize.setAttribute("aria-label", maximized ? "Restore window" : "Maximize window");
    }

    return [controls];
  }

  /* -------------------------------------------------------------- render */

  private render(state: AppState, previous: AppState): void {
    this.root.dataset.sidebar = state.sidebarCollapsed ? "collapsed" : "expanded";
    this.root.dataset.queue = state.queueOpen ? "open" : "closed";

    this.sidebar.update(state);
    this.topbar.update(state);
    this.queuePanel.update(state);
    this.palette.update(state);
    this.syncToasts(state);

    this.topbar.el.hidden = state.view === "now-playing";

    if (state.view !== this.mountedView) {
      this.mountView(state.view);
    } else {
      this.mountedPart?.update(state);
    }

    // The player bar only needs app state when the queue toggle changes.
    if (previous.queueOpen !== state.queueOpen || previous.view !== state.view) {
      this.playerBar.update(state);
    }
  }

  private mountView(view: ViewId): void {
    this.mountedPart?.destroy?.();
    const factory = VIEW_FACTORIES[view];
    this.mountedPart = factory(this.ctx);
    this.mountedView = view;
    this.viewHost.replaceChildren(this.mountedPart.el);
    this.mountedPart.update(getState());
    this.viewHost.scrollTop = 0;

    // Plugins may render into `data-slot` hosts (sidebar footer, settings, ...).
    this.services.plugins.mountSlots?.();

    if (this.pendingSettingsSection && view === "settings") {
      const section = this.pendingSettingsSection;
      this.pendingSettingsSection = null;
      this.scrollToSettingsSection(section);
    }
  }

  private scrollToSettingsSection(section: SettingsSection): void {
    window.requestAnimationFrame(() => {
      const target = this.viewHost.querySelector<HTMLElement>(`[data-settings-section="${section}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  private syncToasts(state: AppState): void {
    const ids = new Set(state.toasts.map((toast) => toast.id));
    for (const toast of state.toasts) {
      if (this.shownToasts.has(toast.id)) continue;
      this.shownToasts.add(toast.id);
      this.toastHost.show(toast.message, toast.kind, 4000);
    }
    for (const id of this.shownToasts) {
      if (!ids.has(id)) this.shownToasts.delete(id);
    }
  }

  /* -------------------------------------------------------------- actions */

  navigate(view: ViewId): void {
    if (getState().view === view) {
      if (view === "settings" && this.pendingSettingsSection) this.scrollToSettingsSection(this.pendingSettingsSection);
      return;
    }
    this.menu.close();
    setState({ view, filter: null, paletteOpen: false });
  }

  openSettings(section?: SettingsSection): void {
    this.pendingSettingsSection = section ?? null;
    if (getState().view === "settings") {
      if (section) this.scrollToSettingsSection(section);
      return;
    }
    this.navigate("settings");
  }

  setQuery(query: string): void {
    setState({ query });
  }

  setFilter(filter: AppState["filter"]): void {
    setState({ filter });
    this.viewHost.scrollTop = 0;
  }

  setSort(key: SortKey): void {
    const { sort } = getState();
    if (sort.key === key) {
      setState({ sort: { key, dir: sort.dir === "asc" ? "desc" : "asc" } });
      return;
    }
    setState({ sort: { key, dir: "asc" } });
  }

  toggleSortDirection(): void {
    const { sort } = getState();
    setState({ sort: { key: sort.key, dir: sort.dir === "asc" ? "desc" : "asc" } });
  }

  openPalette(open: boolean): void {
    setState({ paletteOpen: open });
  }

  toggleQueue(open?: boolean): void {
    const next = open ?? !getState().queueOpen;
    setState({ queueOpen: next });
  }

  toggleSidebar(): void {
    setState({ sidebarCollapsed: !getState().sidebarCollapsed });
  }

  playTracks(tracks: Track[], index = 0): void {
    if (tracks.length === 0) {
      this.toast("Nothing to play yet", "info");
      return;
    }
    const safeIndex = Math.max(0, Math.min(tracks.length - 1, index));
    this.ensureAudio();
    this.ctx.player.playNow(tracks, safeIndex);
  }

  shuffleTracks(tracks: Track[]): void {
    if (tracks.length === 0) {
      this.toast("Nothing to shuffle yet", "info");
      return;
    }
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const current = shuffled[i];
      const other = shuffled[j];
      if (current && other) {
        shuffled[i] = other;
        shuffled[j] = current;
      }
    }
    this.playTracks(shuffled, 0);
    this.ctx.player.setShuffle(true);
    this.toast("Shuffling the current selection", "success");
  }

  enqueueTracks(tracks: Track[]): void {
    if (tracks.length === 0) return;
    this.ctx.player.enqueue(tracks);
    this.toast(tracks.length === 1 ? "Added to the queue" : `Added ${tracks.length} tracks to the queue`, "success");
  }

  showTrackMenu(track: Track, x: number, y: number): void {
    const items: MenuEntry[] = [
      {
        id: "play",
        label: "Play now",
        icon: "play",
        run: () => this.playTracks([track]),
      },
      {
        id: "queue",
        label: "Add to queue",
        icon: "queue",
        run: () => this.enqueueTracks([track]),
      },
      { separator: true },
      {
        id: "album",
        label: "Go to album",
        icon: "albums",
        run: () => {
          this.navigate("albums");
          this.setFilter({ kind: "album", album: track.album, artist: track.albumArtist ?? track.artist });
        },
      },
      {
        id: "artist",
        label: "Go to artist",
        icon: "artists",
        run: () => {
          this.navigate("artists");
          this.setFilter({ kind: "artist", artist: track.artist });
        },
      },
    ];

    if (!this.services.bridge.demo) {
      items.push(
        { separator: true },
        {
          id: "reveal",
          label: "Show in folder",
          icon: "folder",
          run: () => {
            void this.services.bridge.shell.showItemInFolder(track.path).catch((error: unknown) => {
              console.warn("Cadenza: could not reveal file", error);
              this.toast("Could not open the file location", "error");
            });
          },
        },
      );
    }

    this.menu.open(items, x, y);
  }

  showMenu(items: MenuEntry[], x: number, y: number): void {
    this.menu.open(items, x, y);
  }

  async applyTheme(themeId: string, accentId: string): Promise<void> {
    applyThemeVars(themeId, accentId);
    try {
      await this.services.settings.update({ theme: themeId, accent: accentId });
    } catch (error) {
      console.error("Cadenza: could not save the theme", error);
      this.toast("Could not save the theme", "error");
    }
  }

  async scanLibrary(roots: string[]): Promise<void> {
    if (roots.length === 0) {
      this.toast("Add a music folder first", "info");
      return;
    }
    const unsubscribe = this.services.bridge.library.onScanProgress((progress) => setState({ scan: progress }));
    try {
      const result = await this.services.bridge.library.scan(roots);
      this.services.library.upsert(result.tracks);
      if (result.errors.length > 0) this.toast(`${result.errors.length} files could not be read`, "error");
      this.toast(result.tracks.length === 0 ? "No music found in that folder" : `Added ${result.tracks.length} tracks`, result.tracks.length === 0 ? "info" : "success");
    } catch (error) {
      console.error("Cadenza: library scan failed", error);
      this.toast("The library scan failed", "error");
    } finally {
      unsubscribe();
      setState({ scan: null });
    }
  }

  async addMusicFolder(): Promise<void> {
    try {
      const folders = await this.services.bridge.dialog.pickFolders();
      if (folders.length === 0) return;
      const roots = [...new Set([...getState().settings.libraryRoots, ...folders])];
      await this.services.settings.update({ libraryRoots: roots });
      await this.scanLibrary(folders);
    } catch (error) {
      console.error("Cadenza: could not add a music folder", error);
      this.toast("Could not open the folder picker", "error");
    }
  }

  async rescan(): Promise<void> {
    const roots = getState().settings.libraryRoots;
    if (roots.length === 0) {
      await this.addMusicFolder();
      return;
    }
    await this.scanLibrary(roots);
  }

  focusSearch(): void {
    // Views without a search field need the library view to focus it.
    if (getState().view === "now-playing" || getState().view === "settings") this.navigate("library");
    window.requestAnimationFrame(() => this.topbar.focusSearch());
  }

  toast(message: string, kind: "info" | "success" | "error" = "info"): void {
    pushToast(message, kind);
  }

  ensureAudio(): AnalyserNode | null {
    if (this.analyser) {
      void this.audioContext?.resume().catch(() => undefined);
      return this.analyser;
    }
    const element = this.services.audioElement;
    if (!element) return null;

    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(element);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyser.connect(context.destination);
      this.audioContext = context;
      this.analyser = analyser;
      void context.resume().catch(() => undefined);
      return analyser;
    } catch (error) {
      // Browsers refuse a second MediaElementSource for the same element.
      console.warn("Cadenza: could not create the audio analyser", error);
      return null;
    }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  version(): string {
    return this.services.bridge.versions.app || "0.1.0";
  }

  /* ------------------------------------------------------------- commands */

  private createCommands(): Command[] {
    const player = (): AppServices["player"] => this.ctx.player;
    return [
      {
        id: "nav.library",
        title: "Go to Library",
        keywords: ["view", "music", "songs"],
        run: () => this.navigate("library"),
      },
      {
        id: "nav.albums",
        title: "Go to Albums",
        keywords: ["view", "covers"],
        run: () => this.navigate("albums"),
      },
      {
        id: "nav.artists",
        title: "Go to Artists",
        keywords: ["view", "bands"],
        run: () => this.navigate("artists"),
      },
      {
        id: "nav.playlists",
        title: "Go to Playlists",
        keywords: ["view", "import", "export"],
        run: () => this.navigate("playlists"),
      },
      {
        id: "view.now-playing",
        title: "Open Now playing",
        keywords: ["cover", "lyrics", "visualizer"],
        shortcut: "N",
        run: () => this.navigate("now-playing"),
      },
      {
        id: "player.play-pause",
        title: "Play or pause",
        keywords: ["toggle", "stop"],
        shortcut: "Space",
        run: () => player().toggle(),
      },
      {
        id: "player.next",
        title: "Next track",
        keywords: ["skip"],
        shortcut: "Ctrl Right",
        run: () => player().next(),
      },
      {
        id: "player.previous",
        title: "Previous track",
        keywords: ["back"],
        shortcut: "Ctrl Left",
        run: () => player().previous(),
      },
      {
        id: "player.stop",
        title: "Stop playback",
        run: () => player().stop(),
      },
      {
        id: "player.shuffle",
        title: "Toggle shuffle",
        shortcut: "S",
        run: () => {
          const snapshot = player().snapshot;
          player().setShuffle(!snapshot.shuffle);
        },
      },
      {
        id: "player.repeat",
        title: "Cycle repeat mode",
        shortcut: "R",
        run: () => {
          const snapshot = player().snapshot;
          const index = REPEAT_ORDER.indexOf(snapshot.repeat);
          const next = REPEAT_ORDER[(index + 1) % REPEAT_ORDER.length] ?? "off";
          player().setRepeat(next);
        },
      },
      {
        id: "queue.toggle",
        title: "Toggle the queue panel",
        shortcut: "Ctrl Q",
        run: () => this.toggleQueue(),
      },
      {
        id: "queue.clear",
        title: "Clear the queue",
        run: () => {
          player().clearQueue();
          this.toast("Queue cleared", "success");
        },
      },
      {
        id: "theme.cycle",
        title: "Cycle the theme",
        keywords: ["midnight", "daylight", "synthwave", "appearance"],
        run: () => {
          const currentIndex = THEMES.findIndex((theme) => theme.id === getState().settings.theme);
          const next = THEMES[(currentIndex + 1) % THEMES.length];
          if (next) void this.applyTheme(next.id, getState().settings.accent);
        },
      },
      {
        id: "library.add-folder",
        title: "Add a music folder",
        keywords: ["scan", "import", "files"],
        run: () => void this.addMusicFolder(),
      },
      {
        id: "library.rescan",
        title: "Rescan the library",
        keywords: ["refresh", "scan"],
        run: () => void this.rescan(),
      },
      {
        id: "app.settings",
        title: "Open Settings",
        keywords: ["preferences", "options", "plugins", "theme"],
        run: () => this.navigate("settings"),
      },
      {
        id: "app.plugins",
        title: "Open the plugins settings",
        keywords: ["extensions", "addons"],
        run: () => this.openSettings("plugins"),
      },
      {
        id: "app.palette",
        title: "Open the command palette",
        shortcut: "Ctrl K",
        run: () => this.openPalette(true),
      },
      {
        id: "app.sidebar",
        title: "Toggle the sidebar",
        run: () => this.toggleSidebar(),
      },
    ];
  }

  /* ------------------------------------------------------------- keyboard */

  private handleKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const editable =
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable='true']") !== null;

    if (event.key === "Escape") {
      if (getState().paletteOpen) {
        event.preventDefault();
        this.openPalette(false);
        return;
      }
      if (this.menu.isOpen()) {
        event.preventDefault();
        this.menu.close();
        return;
      }
      if (getState().filter) {
        event.preventDefault();
        this.setFilter(null);
      }
      return;
    }

    if (editable || getState().paletteOpen) return;

    const snapshot = (): PlayerSnapshot => this.ctx.player.snapshot;
    const modifier = event.ctrlKey || event.metaKey;

    if (modifier) {
      switch (event.key.toLowerCase()) {
        case "f":
          event.preventDefault();
          this.focusSearch();
          return;
        case "k":
          event.preventDefault();
          this.openPalette(true);
          return;
        case "q":
          event.preventDefault();
          this.toggleQueue();
          return;
        default:
          break;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.ctx.player.previous();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        this.ctx.player.next();
        return;
      }
      return;
    }

    switch (event.key) {
      case " ":
        event.preventDefault();
        this.ensureAudio();
        this.ctx.player.toggle();
        return;
      case "ArrowLeft":
        event.preventDefault();
        this.seekBy(-5);
        return;
      case "ArrowRight":
        event.preventDefault();
        this.seekBy(5);
        return;
      case "ArrowUp":
        event.preventDefault();
        this.changeVolume(0.05);
        return;
      case "ArrowDown":
        event.preventDefault();
        this.changeVolume(-0.05);
        return;
      case "m":
      case "M":
        event.preventDefault();
        this.ctx.player.setMuted(!snapshot().muted);
        return;
      case "s":
      case "S":
        event.preventDefault();
        this.ctx.player.setShuffle(!snapshot().shuffle);
        return;
      case "r":
      case "R": {
        event.preventDefault();
        const current = snapshot().repeat;
        const index = REPEAT_ORDER.indexOf(current);
        const next = REPEAT_ORDER[(index + 1) % REPEAT_ORDER.length] ?? "off";
        this.ctx.player.setRepeat(next);
        return;
      }
      case "n":
      case "N":
        event.preventDefault();
        this.navigate("now-playing");
        return;
      default:
        return;
    }
  }

  private seekBy(deltaSeconds: number): void {
    const snapshot = this.ctx.player.snapshot;
    const duration = snapshot.duration > 0 ? snapshot.duration : (snapshot.track?.duration ?? 0);
    const target = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, snapshot.position + deltaSeconds));
    this.ctx.player.seek(target);
  }

  private changeVolume(delta: number): void {
    const snapshot = this.ctx.player.snapshot;
    const volume = Math.max(0, Math.min(1, snapshot.volume + delta));
    this.ctx.player.setVolume(volume);
    if (snapshot.muted && volume > 0) this.ctx.player.setMuted(false);
  }
}
