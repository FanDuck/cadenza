/**
 * IPC surface of the main process. Every handler is defensive: a bad request
 * from the renderer returns null instead of taking the app down.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fsp from "node:fs/promises";
import path from "node:path";
import type { LyricsDoc, PlaylistFile, PlayerSnapshot, PluginInfo, ScanProgress, Track } from "@fanduck/cadenza-core";
import { detectPlaylistFormat, parseLrc, parseM3u, parsePls, serializeM3u } from "@fanduck/cadenza-core";
import { IPC, type AppInfo, type HostCommand, type ScanResult } from "../shared/ipc.js";
import { readCover, readTrack, scanLibrary } from "./scanner.js";
import { listPlugins } from "./plugins.js";
import type { SettingsStore } from "./settings.js";

export interface AppPaths {
  userData: string;
  covers: string;
  plugins: string;
  lyrics: string;
}

export interface AppContext {
  window: () => BrowserWindow | null;
  settings: SettingsStore;
  paths: AppPaths;
  /** Most recent scan result, kept so the renderer can be re-hydrated. */
  tracks: Track[];
  scannedAt: number | null;
  send: (channel: string, payload: unknown) => void;
}

let scanAbort: AbortController | null = null;

export function registerIpc(ctx: AppContext): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: "Cadenza",
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userDataPath: ctx.paths.userData,
    pluginDir: ctx.paths.plugins,
  }));

  ipcMain.handle(IPC.appQuit, () => {
    app.quit();
  });

  /* ------------------------------------------------------------- window */

  ipcMain.handle(IPC.windowMinimize, () => ctx.window()?.minimize());
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    const win = ctx.window();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(IPC.windowClose, () => ctx.window()?.close());
  ipcMain.handle(IPC.windowIsMaximized, () => ctx.window()?.isMaximized() ?? false);

  /* ------------------------------------------------------------ dialogs */

  ipcMain.handle(IPC.dialogPickFolders, async (): Promise<string[]> => {
    const win = ctx.window();
    const options: Electron.OpenDialogOptions = {
      title: "Add music folders",
      properties: ["openDirectory", "multiSelections"],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC.dialogPickPlaylist, async (): Promise<string | null> => {
    const win = ctx.window();
    const options: Electron.OpenDialogOptions = {
      title: "Import playlist",
      filters: [{ name: "Playlists", extensions: ["m3u", "m3u8", "pls"] }],
      properties: ["openFile"],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  /* ------------------------------------------------------------ library */

  ipcMain.handle(IPC.libraryScan, async (_event, roots: unknown): Promise<ScanResult> => {
    const list = Array.isArray(roots) ? roots.filter((r): r is string => typeof r === "string" && r.length > 0) : [];
    if (list.length === 0) return { tracks: [], errors: [], scannedAt: Date.now() };

    scanAbort?.abort();
    scanAbort = new AbortController();
    const signal = scanAbort.signal;

    const onProgress = (progress: ScanProgress): void => {
      ctx.send(IPC.libraryScanProgress, progress);
    };

    const outcome = await scanLibrary({ roots: list, coversDir: ctx.paths.covers, signal, onProgress });

    if (!signal.aborted) {
      // Merge with previously known tracks so removing a folder from the list
      // does not wipe its tracks until the next full rescan.
      const seen = new Map<string, Track>();
      for (const track of [...ctx.tracks, ...outcome.tracks]) {
        const existing = seen.get(track.id);
        seen.set(track.id, existing ? { ...existing, ...track } : track);
      }
      ctx.tracks = [...seen.values()];
      ctx.scannedAt = outcome.scannedAt;
      ctx.settings.set("lastScanAt", outcome.scannedAt);
      ctx.send(IPC.libraryChanged, { tracks: ctx.tracks, total: ctx.tracks.length, scannedAt: ctx.scannedAt });
    }

    return { tracks: outcome.tracks, errors: outcome.errors, scannedAt: outcome.scannedAt };
  });

  ipcMain.handle(IPC.libraryCancelScan, () => {
    scanAbort?.abort();
    scanAbort = null;
  });

  ipcMain.handle(IPC.libraryReadTrack, async (_event, file: unknown): Promise<Track | null> => {
    if (typeof file !== "string") return null;
    return readTrack(file, ctx.paths.covers);
  });

  ipcMain.handle(IPC.libraryCover, async (_event, coverId: unknown): Promise<string | null> => {
    if (typeof coverId !== "string") return null;
    return readCover(ctx.paths.covers, coverId);
  });

  /* ----------------------------------------------------------- settings */

  ipcMain.handle(IPC.settingsAll, () => ctx.settings.all());
  ipcMain.handle(IPC.settingsGet, (_event, key: unknown, fallback: unknown) =>
    typeof key === "string" ? ctx.settings.get(key, fallback) : fallback,
  );
  ipcMain.handle(IPC.settingsSet, async (_event, key: unknown, value: unknown) => {
    if (typeof key !== "string") return;
    ctx.settings.set(key, value);
  });

  /* ---------------------------------------------------------- playlists */

  ipcMain.handle(IPC.playlistsExport, async (_event, name: unknown, entries: unknown): Promise<string | null> => {
    if (!Array.isArray(entries)) return null;
    const rows = entries
      .filter((e): e is { path: string; title?: string; duration?: number } => Boolean(e) && typeof (e as { path?: unknown }).path === "string")
      .map((e) => ({ path: e.path, title: e.title, duration: e.duration }));
    const safeName = typeof name === "string" && name.trim().length > 0 ? name.trim() : "Cadenza playlist";
    const win = ctx.window();
    const options: Electron.SaveDialogOptions = {
      title: "Export playlist",
      defaultPath: `${safeName}.m3u8`,
      filters: [
        { name: "M3U8 playlist", extensions: ["m3u8"] },
        { name: "M3U playlist", extensions: ["m3u"] },
      ],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    // Both .m3u and .m3u8 are written as UTF-8: Windows players handle it fine
    // and it keeps non-Latin file names intact.
    await fsp.writeFile(result.filePath, serializeM3u(rows), "utf8");
    return result.filePath;
  });

  ipcMain.handle(IPC.playlistsImport, async (_event, file: unknown): Promise<PlaylistFile | null> => {
    if (typeof file !== "string") return null;
    try {
      const text = await fsp.readFile(file, "utf8");
      const format = detectPlaylistFormat(file, text);
      const baseDir = path.dirname(file);
      if (format === "pls") return parsePls(text, baseDir);
      return parseM3u(text, baseDir);
    } catch {
      return null;
    }
  });

  /* ------------------------------------------------------------ plugins */

  ipcMain.handle(IPC.pluginsList, async (): Promise<PluginInfo[]> => listPlugins(ctx.paths.plugins));
  ipcMain.handle(IPC.pluginsReload, async (): Promise<PluginInfo[]> => listPlugins(ctx.paths.plugins));
  ipcMain.handle(IPC.pluginsOpenFolder, async () => {
    await fsp.mkdir(ctx.paths.plugins, { recursive: true });
    await shell.openPath(ctx.paths.plugins);
  });

  /* ------------------------------------------------------------- lyrics */

  ipcMain.handle(IPC.lyricsFor, async (_event, trackPath: unknown): Promise<LyricsDoc | null> => {
    if (typeof trackPath !== "string") return null;
    const candidate = trackPath.replace(/\.[^.\\/]+$/, ".lrc");
    try {
      const text = await fsp.readFile(candidate, "utf8");
      return { ...parseLrc(text), source: "sidecar" };
    } catch {
      return null;
    }
  });

  /* -------------------------------------------------------------- shell */

  ipcMain.handle(IPC.shellOpenExternal, async (_event, url: unknown) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle(IPC.shellShowItem, async (_event, file: unknown) => {
    if (typeof file === "string") shell.showItemInFolder(file);
  });

  /* ------------------------------------------------- taskbar / thumbar */

  ipcMain.on(IPC.playerReport, (_event, snapshot: PlayerSnapshot) => {
    const win = ctx.window();
    if (!win || !snapshot || typeof snapshot !== "object") return;
    const total = Number(snapshot.duration);
    const position = Number(snapshot.position);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(position)) {
      win.setProgressBar(Math.min(1, Math.max(0, position / total)), { mode: snapshot.state === "paused" ? "paused" : "normal" });
    } else {
      win.setProgressBar(-1);
    }
  });
}

/** Push a host command (menu item, media key, tray) at the renderer. */
export function sendCommand(ctx: AppContext, command: HostCommand): void {
  ctx.send(IPC.command, command);
}
