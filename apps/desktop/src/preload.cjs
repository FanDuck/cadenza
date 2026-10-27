// Preload bridge: the only place renderer code can reach the main process.
//
// Deliberately plain CommonJS with zero build steps: a broken TypeScript build
// can never lock the app out of its own bridge, and sandboxed preloads must be
// CJS anyway.
//
// Channel names mirror `src/shared/ipc.ts` (the preload cannot import TS types).
const { contextBridge, ipcRenderer } = require("electron");
const path = require("node:path");

const IPC = {
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
  libraryChanged: "library:changed",
  command: "app:command",
};

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const bridge = {
  platform: process.platform,
  demo: false,
  versions: {
    app: process.env.CADENZA_VERSION || "0.1.0",
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },

  mediaUrl(filePath) {
    // Keep in sync with `mediaUrlFor()` in src/main/protocols.ts.
    return `cadenza-media://file/${encodeURIComponent(path.resolve(String(filePath)))}`;
  },

  app: {
    info: () => invoke(IPC.appInfo),
    quit: () => invoke(IPC.appQuit),
  },

  window: {
    minimize: () => invoke(IPC.windowMinimize),
    toggleMaximize: () => invoke(IPC.windowToggleMaximize),
    close: () => invoke(IPC.windowClose),
    isMaximized: () => invoke(IPC.windowIsMaximized),
    onMaximizedChange: (listener) =>
      subscribe(IPC.windowMaximizedChanged, (value) => listener(Boolean(value))),
  },

  dialog: {
    pickFolders: () => invoke(IPC.dialogPickFolders),
    pickPlaylist: () => invoke(IPC.dialogPickPlaylist),
  },

  library: {
    scan: (roots) => invoke(IPC.libraryScan, roots),
    cancelScan: () => invoke(IPC.libraryCancelScan),
    onScanProgress: (listener) => subscribe(IPC.libraryScanProgress, listener),
    readTrack: (file) => invoke(IPC.libraryReadTrack, file),
    cover: (coverId) => invoke(IPC.libraryCover, coverId),
  },

  settings: {
    all: () => invoke(IPC.settingsAll),
    get: (key, fallback) => invoke(IPC.settingsGet, key, fallback),
    set: (key, value) => invoke(IPC.settingsSet, key, value),
  },

  playlists: {
    export: (name, entries) => invoke(IPC.playlistsExport, name, entries),
    import: (file) => invoke(IPC.playlistsImport, file),
  },

  plugins: {
    list: () => invoke(IPC.pluginsList),
    reload: () => invoke(IPC.pluginsReload),
    openFolder: () => invoke(IPC.pluginsOpenFolder),
  },

  lyrics: {
    for: (trackPath) => invoke(IPC.lyricsFor, trackPath),
  },

  player: {
    report: (snapshot) => {
      ipcRenderer.send(IPC.playerReport, snapshot);
    },
  },

  shell: {
    openExternal: (url) => invoke(IPC.shellOpenExternal, url),
    showItemInFolder: (file) => invoke(IPC.shellShowItem, file),
  },

  onCommand: (listener) => subscribe(IPC.command, listener),
  onLibraryChanged: (listener) => subscribe(IPC.libraryChanged, listener),
};

contextBridge.exposeInMainWorld("cadenza", bridge);
