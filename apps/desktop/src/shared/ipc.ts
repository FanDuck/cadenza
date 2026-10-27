/**
 * The contract between the Electron main process, the preload bridge and the
 * renderer. Everything crossing a process boundary is described here once.
 */

import type {
  AppSettings,
  LibrarySnapshot,
  LyricsDoc,
  PlaylistFile,
  PluginInfo,
  PlayerSnapshot,
  ScanProgress,
  Track,
} from "@fanduck/cadenza-core";

/** Channel names. Kept as literals so the preload (plain CJS) can use them too. */
export const IPC = {
  appInfo: "app:info",
  appQuit: "app:quit",

  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowIsMaximized: "window:is-maximized",
  windowMaximizedChanged: "window:maximized-changed",

  dialogPickFolders: "dialog:pick-folders",
  dialogPickPlaylist: "dialog:pick-playlist",

  libraryScan: "library:scan",
  libraryCancelScan: "library:cancel-scan",
  libraryReadTrack: "library:read-track",
  libraryCover: "library:cover",
  libraryScanProgress: "library:scan-progress",

  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsAll: "settings:all",

  playlistsExport: "playlists:export",
  playlistsImport: "playlists:import",

  pluginsList: "plugins:list",
  pluginsReload: "plugins:reload",
  pluginsOpenFolder: "plugins:open-folder",

  lyricsFor: "lyrics:for",
  lyricsSave: "lyrics:save",

  playerReport: "player:report",
  shellOpenExternal: "shell:open-external",
  shellShowItem: "shell:show-item",

  /** main -> renderer */
  command: "app:command",
  libraryChanged: "library:changed",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userDataPath: string;
  pluginDir: string;
}

export interface ScanResult {
  tracks: Track[];
  errors: string[];
  scannedAt: number;
}

/** Commands the main process can push at the renderer (media keys, menus, tray). */
export type HostCommand = "play-pause" | "next" | "previous" | "stop" | "focus-search" | "open-settings" | "toggle-queue";

/** The object exposed on `window.cadenza`. */
export interface CadenzaBridge {
  platform: string;
  versions: { app: string; electron: string; chrome: string; node: string };
  /** Always false in Electron; the browser demo bridge sets it to true. */
  demo: boolean;
  /**
   * URL the `<audio>` element can play. Electron returns a `cadenza-media://`
   * URL (range-capable); the demo bridge returns "".
   */
  mediaUrl(filePath: string): string;
  app: {
    info(): Promise<AppInfo>;
    quit(): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(listener: (maximized: boolean) => void): () => void;
  };
  dialog: {
    pickFolders(): Promise<string[]>;
    pickPlaylist(): Promise<string | null>;
  };
  library: {
    scan(roots: string[]): Promise<ScanResult>;
    cancelScan(): Promise<void>;
    onScanProgress(listener: (progress: ScanProgress) => void): () => void;
    readTrack(path: string): Promise<Track | null>;
    /** Returns a `data:` URL for a cached cover, or null. */
    cover(coverId: string): Promise<string | null>;
  };
  settings: {
    all(): Promise<Partial<AppSettings>>;
    get<T>(key: string, fallback: T): Promise<T>;
    set(key: string, value: unknown): Promise<void>;
  };
  playlists: {
    export(name: string, entries: string[]): Promise<string | null>;
    import(path: string): Promise<PlaylistFile | null>;
  };
  plugins: {
    list(): Promise<PluginInfo[]>;
    reload(): Promise<PluginInfo[]>;
    openFolder(): Promise<void>;
  };
  lyrics: {
    for(trackPath: string): Promise<LyricsDoc | null>;
  };
  player: {
    /** Report the current snapshot so the main process can update the taskbar. */
    report(snapshot: PlayerSnapshot): void;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): Promise<void>;
  };
  onCommand(listener: (command: HostCommand) => void): () => void;
  onLibraryChanged(listener: (snapshot: LibrarySnapshot) => void): () => void;
}
