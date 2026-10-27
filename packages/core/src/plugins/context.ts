/**
 * Builds the {@link PluginContext} handed to a plugin when it is activated.
 *
 * The host-specific pieces (command registry, DOM slot registry, settings
 * storage, theme variables) are injected through small bridge interfaces so the
 * plugin system stays testable and does not hard-code a UI.
 */

import type { Library } from "../library.js";
import type { Player } from "../player.js";
import type {
  Command,
  Disposable,
  LibrarySnapshot,
  PlayerSnapshot,
  PluginContext,
  PluginInfo,
  SlotName,
  Track,
} from "../types.js";

/** What a plugin context needs from the host. `PluginHost` implements this. */
export interface PluginHostBridge {
  /** Register a command contributed by a plugin. Returns a disposable that removes it. */
  registerCommand(pluginId: string, command: Command): Disposable;
  /** Track a resource owned by a plugin so it is released on deactivation. */
  trackDisposable(pluginId: string, disposable: Disposable): void;
}

/** UI region registry owned by the renderer. */
export interface SlotRegistry {
  /** Element that hosts a slot, or `null` when the UI does not expose that slot. */
  get(name: SlotName): HTMLElement | null;
}

/** Synchronous settings storage shared by the app and all plugins. */
export interface SettingsScope {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}

/** Theme variable access, normally backed by `document.documentElement`. */
export interface ThemeBridge {
  /** Current value of a CSS custom property (empty string when unset). */
  getVar(name: string): string;
  setVar(name: string, value: string): void;
  removeVar(name: string): void;
}

/** Collaborators injected into {@link createPluginContext}. */
export interface PluginContextDeps {
  player: Player;
  library: Library;
  slots: SlotRegistry;
  settings: SettingsScope;
  theme: ThemeBridge;
}

type PlayerEvent = "trackchange" | "statechange" | "position";

/**
 * Create the API surface a plugin is allowed to use.
 *
 * Every subscription, command, slot mount and theme override created here is
 * tracked on the host, so `PluginHost.deactivateAll()` can release all of them
 * even when the plugin forgets to dispose something.
 */
export function createPluginContext(host: PluginHostBridge, info: PluginInfo, deps: PluginContextDeps): PluginContext {
  const pluginId = info.manifest.id;
  const version = info.manifest.version;
  const settingsPrefix = `plugin.${pluginId}.`;

  const log = (...args: unknown[]): void => {
    console.log(`[plugin:${pluginId}]`, ...args);
  };

  const subscribePlayer = (event: PlayerEvent, listener: (snapshot: PlayerSnapshot) => void): Disposable => {
    let lastTrackId = deps.player.snapshot.track?.id ?? null;
    let lastState = deps.player.snapshot.state;
    const unsubscribe = deps.player.bus.on("player:snapshot", (snapshot) => {
      if (event === "trackchange") {
        const trackId = snapshot.track?.id ?? null;
        if (trackId === lastTrackId) return;
        lastTrackId = trackId;
      } else if (event === "statechange") {
        if (snapshot.state === lastState) return;
        lastState = snapshot.state;
      }
      listener(snapshot);
    });
    const disposable: Disposable = {
      dispose: () => {
        unsubscribe();
      },
    };
    host.trackDisposable(pluginId, disposable);
    return disposable;
  };

  const subscribeLibrary = (listener: (snapshot: LibrarySnapshot) => void): Disposable => {
    const unsubscribe = deps.library.bus.on("library:change", (snapshot) => {
      listener(snapshot);
    });
    const disposable: Disposable = {
      dispose: () => {
        unsubscribe();
      },
    };
    host.trackDisposable(pluginId, disposable);
    return disposable;
  };

  return {
    pluginId,
    version,
    player: {
      snapshot: (): PlayerSnapshot => deps.player.snapshot,
      play: (track?: Track): Promise<void> => deps.player.play(track),
      pause: (): void => deps.player.pause(),
      next: (): Promise<void> => deps.player.next(),
      previous: (): Promise<void> => deps.player.previous(),
      seek: (seconds: number): void => deps.player.seek(seconds),
      setVolume: (volume: number): void => deps.player.setVolume(volume),
      enqueue: (tracks: Track[]): void => deps.player.enqueue(tracks),
      on: (event: PlayerEvent, listener: (snapshot: PlayerSnapshot) => void): Disposable =>
        subscribePlayer(event, listener),
    },
    library: {
      tracks: (): Track[] => deps.library.tracks,
      search: (text: string): Track[] => deps.library.search(text),
      on: (_event: "change", listener: (snapshot: LibrarySnapshot) => void): Disposable => subscribeLibrary(listener),
    },
    commands: {
      register: (command: Command): Disposable => host.registerCommand(pluginId, command),
    },
    ui: {
      slot: (name: SlotName, render: (element: HTMLElement) => void): Disposable => {
        const container = deps.slots.get(name);
        if (!container) {
          log(`slot "${name}" is not available`);
          return { dispose: () => {} };
        }
        const element = container.ownerDocument.createElement("div");
        element.dataset.pluginId = pluginId;
        container.append(element);
        const disposable: Disposable = {
          dispose: () => {
            element.remove();
          },
        };
        host.trackDisposable(pluginId, disposable);
        render(element);
        return disposable;
      },
    },
    settings: {
      get: <T,>(key: string, fallback: T): T => deps.settings.get(settingsPrefix + key, fallback),
      set: <T,>(key: string, value: T): void => deps.settings.set(settingsPrefix + key, value),
    },
    theme: {
      setVar: (name: string, value: string): Disposable => {
        if (!name.startsWith("--")) {
          throw new Error(`[plugin:${pluginId}] theme variables must start with "--": ${name}`);
        }
        const previous = deps.theme.getVar(name);
        deps.theme.setVar(name, value);
        const disposable: Disposable = {
          dispose: () => {
            if (previous.length > 0) deps.theme.setVar(name, previous);
            else deps.theme.removeVar(name);
          },
        };
        host.trackDisposable(pluginId, disposable);
        return disposable;
      },
    },
    log,
  };
}
