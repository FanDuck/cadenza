/**
 * Renderer boot.
 *
 * Wires the frozen pieces together and hands them to `App`:
 *
 *   bridge  ->  EventBus  ->  Player (HtmlAudioSink) + Library + PluginHost
 *                                   |
 *                                   +-> App (DOM) + views + parts
 *
 * Everything is awaited before the first paint so the app never flashes an
 * empty library or the wrong theme.
 */

import {
  EventBus,
  HtmlAudioSink,
  Library,
  Player,
  PluginHost,
  createPluginContext,
  type AppSettings,
  type Command,
  type CoreEvents,
  type LibrarySnapshot,
  type PlayerSnapshot,
  type PluginInfo,
  type PluginContext,
  type QueueState,
  type RepeatMode,
  type SlotName,
  type Track,
} from "@fanduck/cadenza-core";
import { defineCadenzaElements } from "@fanduck/cadenza-ui";
import { App } from "./app.js";
import { getBridge } from "./bridge.js";
import {
  DEFAULT_SETTINGS,
  PersistentStore,
  pushToast,
  readPlaylists,
  setState,
  type LibraryApi,
  type PlayerApi,
  type PluginApi,
  type SettingsApi,
} from "./state.js";
import { applyTheme } from "./themes.js";
import { h } from "./dom.js";

/** Structural copies of the plugin-context dependencies (core types are not re-exported by name). */
interface SlotRegistryLike {
  get(name: SlotName): HTMLElement | null;
}
interface SettingsScopeLike {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}
interface ThemeBridgeLike {
  getVar(name: string): string;
  setVar(name: string, value: string): void;
  removeVar(name: string): void;
}

const VALID_REPEAT: readonly RepeatMode[] = ["off", "all", "one"];

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("Cadenza renderer: #app is missing");

  // 1. Host bridge (Electron preload, or the in-memory browser demo).
  const bridge = getBridge();

  // 2. UI kit custom elements must be registered before any view creates one.
  defineCadenzaElements();

  // 3. Persistence: the settings file from main, read once into a sync store.
  const store = await PersistentStore.open(bridge);
  const saved = await readSettings(bridge);
  const settings = mergeSettings(saved);
  applyTheme(settings.theme, settings.accent);

  // 4. Core engine.
  const bus = new EventBus<CoreEvents>();
  const sink = new HtmlAudioSink();
  const player = new Player(sink, { bus, resolveUrl: (track: Track) => bridge.mediaUrl(track.path) });
  const library = new Library(store, bus);

  // Engine errors surface as toasts (the player bar renders its own).
  bus.on("plugin:error", ({ id, message }) => {
    pushToast(`Plugin "${id}" failed: ${message}`, "error");
  });
  bus.on("app:error", ({ scope, message }) => {
    if (scope === "player") return;
    pushToast(`${scope}: ${message}`, "error");
  });

  // Restore the library (persisted by the core Library under the "library" key).
  try {
    await library.load();
  } catch (error) {
    console.warn("Cadenza: could not restore the library", error);
  }

  // Player state that is not part of the queue.
  player.setVolume(settings.volume);
  player.setMuted(settings.muted);
  player.setShuffle(settings.shuffle);
  player.setRepeat(settings.repeat);

  // Restore the play queue when the user asked for it (this also restores the
  // shuffle/repeat flags stored with the queue, which win over the settings).
  restoreQueue(player, store, settings);

  // 5. Plugins. Slots are detached <div>s until the shell mounts; `mountSlots()`
  //    moves them into the real `data-slot` hosts later. That lets plugins
  //    render into settings/now-playing even when those views are not open yet.
  const slots = createSlotRegistry();
  const pluginSettings: SettingsScopeLike = {
    get: <T,>(key: string, fallback: T): T => store.get(`plugin.${key}`, fallback),
    set: <T,>(key: string, value: T): void => {
      store.set(`plugin.${key}`, value);
      void store.flush();
    },
  };
  const themeBridge: ThemeBridgeLike = {
    getVar: (name) => document.documentElement.style.getPropertyValue(name) || getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    setVar: (name, value) => document.documentElement.style.setProperty(name, value),
    removeVar: (name) => document.documentElement.style.removeProperty(name),
  };

  const host: PluginHost = new PluginHost({
    bus,
    createContext: (info: PluginInfo): PluginContext =>
      createPluginContext(host, info, { player, library, slots, settings: pluginSettings, theme: themeBridge }),
  });

  let pluginInfos: PluginInfo[] = [];
  try {
    pluginInfos = await bridge.plugins.list();
  } catch (error) {
    console.warn("Cadenza: could not list plugins", error);
  }
  for (const info of pluginInfos) host.register(info);

  // Activate before the shell mounts: slot containers keep rendered DOM until
  // `mountSlots()` adopts them, and plugin commands must exist for the palette.
  try {
    await host.activateAll();
  } catch (error) {
    console.error("Cadenza: plugin activation failed", error);
  }

  // Commands contributed by plugins show up in the palette next to the app ones.
  const commands: Command[] = [...host.commands];

  // 6. Services handed to the shell/views.
  const settingsApi = createSettingsApi(store, settings);
  const libraryApi: LibraryApi = {
    tracks: () => library.tracks,
    upsert: (tracks) => {
      library.upsert(tracks);
      void library.save();
    },
    remove: (id) => {
      library.remove(id);
      void library.save();
    },
    onChange: (listener: (snapshot: LibrarySnapshot) => void) => bus.on("library:change", listener),
  };
  const pluginApi: PluginApi = {
    list: () => host.list,
    async reload() {
      await host.deactivateAll();
      let infos: PluginInfo[] = [];
      try {
        infos = await bridge.plugins.reload();
      } catch (error) {
        console.warn("Cadenza: plugin reload failed", error);
      }
      for (const info of infos) host.register(info);
      await host.activateAll();
      setState({ plugins: host.list });
      return host.list;
    },
    openFolder: () => bridge.plugins.openFolder(),
    onChange: (listener) => bus.on("plugins:change", listener),
    mountSlots: () => slots.mount(),
  };
  const playerApi: PlayerApi = {
    get snapshot(): PlayerSnapshot {
      return player.snapshot;
    },
    get queue(): QueueState {
      return player.queue.toJSON();
    },
    onSnapshot: (listener) => bus.on("player:snapshot", listener),
    onQueueChange: (listener) => bus.on("queue:change", listener),
    play: (track) => {
      void player.play(track);
    },
    pause: () => player.pause(),
    toggle: () => {
      void player.toggle();
    },
    stop: () => player.stop(),
    next: () => {
      void player.next();
    },
    previous: () => {
      void player.previous();
    },
    seek: (seconds) => player.seek(seconds),
    setVolume: (volume) => player.setVolume(volume),
    setMuted: (muted) => player.setMuted(muted),
    setShuffle: (shuffle) => player.setShuffle(shuffle),
    setRepeat: (repeat) => player.setRepeat(repeat),
    enqueue: (tracks) => player.enqueue(tracks),
    playNow: (tracks, index = 0) => {
      player.queue.setTracks(tracks, index);
      void player.play();
    },
    setQueue: (tracks, index = 0) => player.queue.setTracks(tracks, index),
    clearQueue: () => {
      player.stop();
      player.queue.clear();
    },
  };

  // 7. Initial app state, before the first render.
  setState({
    settings,
    tracks: library.tracks.slice(),
    libraryTotal: library.snapshot.total,
    scannedAt: library.snapshot.scannedAt,
    plugins: host.list,
    playlists: readPlaylists(store),
    ready: true,
  });

  // 8. React to engine events for the rest of the session.
  bus.on("library:change", (snapshot) => {
    setState({ tracks: library.tracks.slice(), libraryTotal: snapshot.total, scannedAt: snapshot.scannedAt });
  });
  bus.on("queue:change", (queue) => {
    store.set("queue", queue);
  });
  bus.on("player:snapshot", (snapshot) => {
    scheduleSessionPersist(store, player, snapshot);
  });

  setState({ plugins: host.list });

  // 9. Mount the UI.
  const app = new App(root, {
    bridge,
    player: playerApi,
    library: libraryApi,
    plugins: pluginApi,
    settings: settingsApi,
    store,
    commands,
    audioElement: sink.element,
  });
  app.mount();

  // 10. Persist on the way out.
  window.addEventListener("beforeunload", () => {
    store.set("queue", player.queue.toJSON());
    store.set("volume", player.snapshot.volume);
    store.set("muted", player.snapshot.muted);
    store.set("shuffle", player.snapshot.shuffle);
    store.set("repeat", player.snapshot.repeat);
    void store.flush();
    app.dispose();
  });
}

/* ---------------------------------------------------------------- helpers */

async function readSettings(bridge: ReturnType<typeof getBridge>): Promise<Partial<AppSettings>> {
  try {
    return await bridge.settings.all();
  } catch (error) {
    console.warn("Cadenza: could not read settings", error);
    return {};
  }
}

/** Validate persisted settings: JSON on disk can be hand-edited or stale. */
function mergeSettings(saved: Partial<AppSettings>): AppSettings {
  const volume = typeof saved.volume === "number" && Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : DEFAULT_SETTINGS.volume;
  return {
    theme: typeof saved.theme === "string" && saved.theme.length > 0 ? saved.theme : DEFAULT_SETTINGS.theme,
    accent: typeof saved.accent === "string" && saved.accent.length > 0 ? saved.accent : DEFAULT_SETTINGS.accent,
    volume,
    muted: typeof saved.muted === "boolean" ? saved.muted : DEFAULT_SETTINGS.muted,
    shuffle: typeof saved.shuffle === "boolean" ? saved.shuffle : DEFAULT_SETTINGS.shuffle,
    repeat: typeof saved.repeat === "string" && VALID_REPEAT.includes(saved.repeat as RepeatMode) ? (saved.repeat as RepeatMode) : DEFAULT_SETTINGS.repeat,
    libraryRoots: Array.isArray(saved.libraryRoots) ? saved.libraryRoots.filter((entry): entry is string => typeof entry === "string") : [],
    resumeSession: typeof saved.resumeSession === "boolean" ? saved.resumeSession : DEFAULT_SETTINGS.resumeSession,
    mediaKeys: typeof saved.mediaKeys === "boolean" ? saved.mediaKeys : DEFAULT_SETTINGS.mediaKeys,
  };
}

function createSettingsApi(store: PersistentStore, initial: AppSettings): SettingsApi {
  let current: AppSettings = initial;
  return {
    current: () => current,
    async update(patch) {
      const merged = { ...current, ...patch };
      if (typeof merged.volume === "number") merged.volume = Math.max(0, Math.min(1, merged.volume));
      current = merged;
      for (const [key, value] of Object.entries(patch)) store.set(key, value);
      setState({ settings: merged });
      if (patch.theme !== undefined || patch.accent !== undefined) applyTheme(merged.theme, merged.accent);
      await store.flush();
    },
  };
}

/** Restore the queue from the store, validating the persisted JSON. */
function restoreQueue(player: Player, store: PersistentStore, settings: AppSettings): void {
  if (!settings.resumeSession) return;
  const saved = store.get<unknown>("queue", null);
  const queue = asQueueState(saved);
  if (!queue) return;
  try {
    player.queue.setTracks(queue.items, queue.index);
    player.queue.setShuffle(queue.shuffle);
    player.queue.setRepeat(queue.repeat);
  } catch (error) {
    console.warn("Cadenza: could not restore the queue", error);
  }
}

function asQueueState(value: unknown): QueueState | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<QueueState>;
  if (!Array.isArray(candidate.items)) return null;
  const items = candidate.items.filter(isTrackLike);
  if (items.length === 0) return null;
  const index = typeof candidate.index === "number" && Number.isInteger(candidate.index) ? Math.max(0, Math.min(items.length - 1, candidate.index)) : 0;
  return {
    items,
    index,
    shuffle: candidate.shuffle === true,
    repeat: VALID_REPEAT.includes(candidate.repeat as RepeatMode) ? (candidate.repeat as RepeatMode) : "off",
  };
}

function isTrackLike(value: unknown): value is Track {
  if (typeof value !== "object" || value === null) return false;
  const track = value as Partial<Track>;
  return (
    typeof track.id === "string" &&
    typeof track.path === "string" &&
    typeof track.title === "string" &&
    typeof track.artist === "string" &&
    typeof track.album === "string" &&
    typeof track.duration === "number"
  );
}

/** Debounced writes for fast-changing session state (volume, queue, modes). */
let sessionTimer: number | null = null;

function scheduleSessionPersist(store: PersistentStore, player: Player, snapshot: PlayerSnapshot): void {
  if (sessionTimer !== null) window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(() => {
    sessionTimer = null;
    store.set("queue", player.queue.toJSON());
    store.set("volume", snapshot.volume);
    store.set("muted", snapshot.muted);
    store.set("shuffle", snapshot.shuffle);
    store.set("repeat", snapshot.repeat);
    void store.flush();
  }, 900);
}

/* --------------------------------------------------------------- slots */

interface SlotRegistryWithMount extends SlotRegistryLike {
  mount(): void;
}

/**
 * Plugins render into detached containers; the shell adopts them into the real
 * `data-slot` hosts whenever a view with that slot is mounted.
 */
const ALL_SLOTS: readonly SlotName[] = ["sidebar:footer", "now-playing:action", "settings:section"];

function createSlotRegistry(): SlotRegistryWithMount {
  const containers = new Map<SlotName, HTMLElement>();

  function containerFor(name: SlotName): HTMLElement {
    let container = containers.get(name);
    if (!container) {
      container = h("div", { class: "plugin-slot", dataset: { pluginSlot: name } });
      containers.set(name, container);
    }
    return container;
  }

  // Create every container up front: plugins activate before the shell mounts,
  // and the containers must exist by then so their content is never lost.
  for (const name of ALL_SLOTS) containerFor(name);

  return {
    get: (name) => containerFor(name),
    mount(): void {
      for (const [name, container] of containers) {
        for (const hostElement of document.querySelectorAll<HTMLElement>(`[data-slot="${name}"]`)) {
          if (container.parentElement !== hostElement) hostElement.append(container);
        }
      }
    },
  };
}

/* ---------------------------------------------------------------- error UI */

function showBootError(error: unknown): void {
  console.error("Cadenza: failed to boot", error);
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;
  const message = error instanceof Error ? error.message : String(error);
  root.replaceChildren(
    h(
      "div",
      { class: "boot-error", style: "padding:48px;max-width:640px;margin:0 auto;font-family:var(--cz-font)" },
      h("h1", { text: "Cadenza could not start" }),
      h("p", { text: message }),
      h("p", { text: "Open DevTools (Ctrl+Shift+I) for the full stack trace." }),
    ),
  );
}

boot().catch(showBootError);
