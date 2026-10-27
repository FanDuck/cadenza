/**
 * The browser demo bridge.
 *
 * `npm run demo` serves the real renderer from a plain static server. There is
 * no Electron, so `window.cadenza` does not exist - `getBridge()` falls back to
 * this in-memory implementation. It implements **every** member of
 * `CadenzaBridge`, backed by localStorage, so the UI cannot tell the difference
 * except for `demo === true`.
 *
 * The simulated file system lives in `sample-library.ts`; playback itself is
 * simulated by the player bar (the demo `mediaUrl()` returns "", so the audio
 * sink has nothing to play).
 */

import type {
  AppSettings,
  LibrarySnapshot,
  LyricsDoc,
  PlaylistFile,
  PluginInfo,
  ScanProgress,
  Track,
} from "@fanduck/cadenza-core";
import type { AppInfo, CadenzaBridge, ScanResult } from "../../shared/ipc.js";
import { DEMO_MUSIC_ROOT, SAMPLE_TRACKS, coverDataUrl, sampleLrc } from "./sample-library.js";

const SETTINGS_KEY = "cadenza.demo.settings.v1";
const EXPORTS_KEY = "cadenza.demo.exports.v1";

/** Where demo "playlists" are written to. */
const DEMO_PLAYLIST_DIR = `${DEMO_MUSIC_ROOT}\\playlists`;

/* ------------------------------------------------------------ utilities */

function cloneTrack(track: Track): Track {
  return { ...track };
}

function cloneTracks(tracks: readonly Track[]): Track[] {
  return tracks.map(cloneTrack);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readObject(key: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch (error) {
    console.warn(`Cadenza demo: could not read ${key}`, error);
    return null;
  }
}

function writeObject(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Private-mode browsers and full quotas must not break the demo.
    console.warn(`Cadenza demo: could not write ${key}`, error);
  }
}

/**
 * First-run settings. The demo starts with a full library and a queue so the
 * app looks alive on the first launch, and because these are ordinary settings
 * keys the core `Library` and `Player` restore them exactly like the real app.
 */
function firstRunSettings(): Record<string, unknown> {
  return {
    theme: "midnight",
    accent: "duck",
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: "off",
    libraryRoots: [DEMO_MUSIC_ROOT],
    resumeSession: true,
    mediaKeys: true,
    library: {
      tracks: cloneTracks(SAMPLE_TRACKS),
      scannedAt: Date.now(),
    },
    queue: {
      items: cloneTracks(SAMPLE_TRACKS),
      index: 0,
      shuffle: false,
      repeat: "off",
    },
  };
}

function readSettings(): Record<string, unknown> {
  return readObject(SETTINGS_KEY) ?? firstRunSettings();
}

/* ------------------------------------------------------------------ LRC */

/** Minimal LRC parser, so the demo does not depend on the core parser. */
function parseDemoLrc(raw: string): LyricsDoc {
  const lines: LyricsDoc["lines"] = [];
  let offset = 0;
  const linePattern = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/u;
  for (const rawLine of raw.split(/\r?\n/u)) {
    const offsetMatch = /^\[offset:([+-]?\d+)\]$/iu.exec(rawLine.trim());
    if (offsetMatch?.[1]) {
      offset = Number(offsetMatch[1]) / 1000;
      continue;
    }
    const match = linePattern.exec(rawLine.trim());
    if (!match) continue;
    const minutes = Number(match[1] ?? 0);
    const seconds = Number(match[2] ?? 0);
    const fractionText = match[3] ?? "0";
    // LRC fractions are centiseconds (2 digits) but tolerate 1-3 digits.
    const fraction = Number(fractionText.padEnd(2, "0").slice(0, 2)) / 100;
    lines.push({ time: minutes * 60 + seconds + fraction, text: (match[4] ?? "").trim() });
  }
  return { lines, offset, source: "sidecar", raw };
}

/* -------------------------------------------------------------- bridge */

export function createDemoBridge(): CadenzaBridge {
  /** Progress listeners registered with `library.onScanProgress`. */
  const scanListeners = new Set<(progress: ScanProgress) => void>();
  const libraryListeners = new Set<(snapshot: { tracks: Track[]; total: number; scannedAt: number | null }) => void>();
  /** Bumped by `cancelScan`; an in-flight scan compares it after every sleep. */
  let scanToken = 0;

  function emitScanProgress(progress: ScanProgress): void {
    for (const listener of scanListeners) listener(progress);
  }

  function notifyLibrary(scannedAt: number): void {
    const snapshot = { tracks: cloneTracks(SAMPLE_TRACKS), total: SAMPLE_TRACKS.length, scannedAt };
    for (const listener of libraryListeners) listener(snapshot);
  }

  function emptyProgress(phase: ScanProgress["phase"]): ScanProgress {
    return { phase, filesFound: 0, filesProcessed: 0, errors: [] };
  }

  const bridge: CadenzaBridge = {
    platform: "demo",
    demo: true,
    versions: {
      app: "0.1.0-demo",
      electron: "",
      chrome: navigator.userAgent,
      node: "",
    },

    mediaUrl() {
      // Nothing is playable in the demo: the player bar simulates playback.
      return "";
    },

    app: {
      async info(): Promise<AppInfo> {
        return {
          name: "Cadenza (demo)",
          version: "0.1.0-demo",
          electron: "none",
          chrome: navigator.userAgent,
          node: "none",
          platform: "demo",
          userDataPath: "C:\\Users\\Demo\\AppData\\Roaming\\Cadenza",
          pluginDir: "C:\\Users\\Demo\\AppData\\Roaming\\Cadenza\\plugins",
        };
      },
      async quit(): Promise<void> {
        // A browser tab cannot close itself unless it was opened by a script.
      },
    },

    window: {
      async minimize(): Promise<void> {},
      async toggleMaximize(): Promise<void> {},
      async close(): Promise<void> {},
      async isMaximized(): Promise<boolean> {
        return false;
      },
      onMaximizedChange(): () => void {
        return () => undefined;
      },
    },

    dialog: {
      async pickFolders(): Promise<string[]> {
        await sleep(120);
        return [DEMO_MUSIC_ROOT];
      },
      async pickPlaylist(): Promise<string | null> {
        await sleep(120);
        return `${DEMO_PLAYLIST_DIR}\\Late Night Drive.m3u8`;
      },
    },

    library: {
      async scan(roots: string[]): Promise<ScanResult> {
        const token = (scanToken += 1);
        const total = SAMPLE_TRACKS.length;
        emitScanProgress({ phase: "discovering", filesFound: 0, filesProcessed: 0, errors: [], ...(roots[0] ? { currentFile: roots[0] } : {}) });
        await sleep(140);
        if (token !== scanToken) {
          emitScanProgress(emptyProgress("cancelled"));
          return { tracks: [], errors: [], scannedAt: Date.now() };
        }

        const tracks = cloneTracks(SAMPLE_TRACKS);
        for (let index = 0; index < tracks.length; index += 1) {
          await sleep(45);
          if (token !== scanToken) {
            emitScanProgress({ phase: "cancelled", filesFound: total, filesProcessed: index, errors: [] });
            return { tracks: tracks.slice(0, index), errors: [], scannedAt: Date.now() };
          }
          const track = tracks[index];
          emitScanProgress({
            phase: "reading",
            filesFound: total,
            filesProcessed: index + 1,
            errors: [],
            ...(track ? { currentFile: track.path } : {}),
          });
        }

        const scannedAt = Date.now();
        emitScanProgress({ phase: "done", filesFound: total, filesProcessed: total, errors: [] });
        notifyLibrary(scannedAt);
        return { tracks, errors: [], scannedAt };
      },

      async cancelScan(): Promise<void> {
        scanToken += 1;
        emitScanProgress(emptyProgress("cancelled"));
      },

      onScanProgress(listener: (progress: ScanProgress) => void): () => void {
        scanListeners.add(listener);
        return () => scanListeners.delete(listener);
      },

      async readTrack(filePath: string): Promise<Track | null> {
        const track = SAMPLE_TRACKS.find((candidate) => candidate.path === filePath);
        return track ? cloneTrack(track) : null;
      },

      async cover(coverId: string): Promise<string | null> {
        return coverDataUrl(coverId);
      },
    },

    settings: {
      async all(): Promise<Partial<AppSettings>> {
        return readSettings() as unknown as Partial<AppSettings>;
      },
      async get<T>(key: string, fallback: T): Promise<T> {
        const settings = readSettings();
        return key in settings ? (settings[key] as T) : fallback;
      },
      async set(key: string, value: unknown): Promise<void> {
        const settings = readSettings();
        settings[key] = value;
        writeObject(SETTINGS_KEY, settings);
        await sleep(10);
      },
    },

    playlists: {
      async export(name: string, entries: string[]): Promise<string | null> {
        const safeName = name.replace(/[\\/:*?"<>|]/gu, "-").trim() || "Cadenza playlist";
        const filePath = `${DEMO_PLAYLIST_DIR}\\${safeName}.m3u8`;
        const exports = readObject(EXPORTS_KEY) ?? {};
        exports[filePath] = { name: safeName, entries };
        writeObject(EXPORTS_KEY, exports);
        await sleep(80);
        return filePath;
      },

      async import(filePath: string): Promise<PlaylistFile | null> {
        await sleep(160);
        const exports = readObject(EXPORTS_KEY) ?? {};
        const saved = exports[filePath];
        const name = fileName(filePath).replace(/\.(m3u8?|pls|cadenza)$/iu, "") || "Imported playlist";

        // A playlist this demo exported earlier: resolve its saved paths.
        if (typeof saved === "object" && saved !== null) {
          const entries = (saved as { entries?: unknown }).entries;
          if (Array.isArray(entries)) {
            const resolved = entries
              .filter((entry): entry is string => typeof entry === "string")
              .map((path) => sampleEntry(path))
              .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
            return { name, format: "m3u8", entries: resolved };
          }
        }

        // Anything else: pretend the file referenced the demo library.
        return {
          name,
          format: filePath.toLowerCase().endsWith(".pls") ? "pls" : "m3u8",
          entries: SAMPLE_TRACKS.slice(0, 8).map((track) => ({
            path: track.path,
            title: track.title,
            duration: track.duration,
          })),
        };
      },
    },

    plugins: {
      async list(): Promise<PluginInfo[]> {
        return [];
      },
      async reload(): Promise<PluginInfo[]> {
        return [];
      },
      async openFolder(): Promise<void> {
        // No plugin folder in a browser.
      },
    },

    lyrics: {
      async for(trackPath: string): Promise<LyricsDoc | null> {
        const raw = sampleLrc(trackPath);
        return raw ? parseDemoLrc(raw) : null;
      },
    },

    player: {
      report(): void {
        // Nothing to report to; the taskbar does not exist in a browser.
      },
    },

    shell: {
      async openExternal(url: string): Promise<void> {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      async showItemInFolder(): Promise<void> {
        // No file manager in a browser.
      },
    },

    onCommand(): () => void {
      // Media keys are handled by the browser in the demo (see app.ts).
      return () => undefined;
    },

    onLibraryChanged(listener: (snapshot: LibrarySnapshot) => void): () => void {
      libraryListeners.add(listener);
      return () => libraryListeners.delete(listener);
    },
  };

  return bridge;
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/u);
  return parts[parts.length - 1] ?? path;
}

function sampleEntry(path: string): { path: string; title?: string; duration?: number } | null {
  const track = SAMPLE_TRACKS.find((candidate) => candidate.path === path);
  if (!track) return null;
  return { path: track.path, title: track.title, duration: track.duration };
}
