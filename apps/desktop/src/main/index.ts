/**
 * Cadenza desktop - main process entry point.
 *
 * Responsibilities: window lifecycle, custom protocols, library scanning,
 * native menus, media keys and the screenshot helper used by the README.
 */

import { app, BrowserWindow, nativeImage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { registerProtocols, registerSchemes } from "./protocols.js";
import { SettingsStore } from "./settings.js";
import { registerIpc, sendCommand, type AppContext, type AppPaths } from "./ipc.js";
import { buildMenu, registerMediaKeys } from "./menu.js";
import type { HostCommand } from "../shared/ipc.js";

const APP_ROOT = path.join(import.meta.dirname, "..", "..");
/**
 * Root the `app://` protocol serves from. Both the repo checkout and the
 * assembled bundle in `release/app` keep the same layout, so two levels up from
 * `apps/desktop` is always right (and works inside an asar archive too).
 */
const WEB_ROOT = path.join(APP_ROOT, "..", "..");
const isDev = !app.isPackaged;

const RENDERER_URL = "app://cadenza/apps/desktop/dist/renderer/index.html";

// A second instance should focus the running player instead of opening a new one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

registerSchemes();
app.setAppUserModelId("dev.fanduck.cadenza");

let mainWindow: BrowserWindow | null = null;
let disposeMediaKeys: (() => void) | null = null;

function paths(): AppPaths {
  const userData = app.getPath("userData");
  return {
    userData,
    covers: path.join(userData, "covers"),
    plugins: path.join(userData, "plugins"),
    lyrics: path.join(userData, "lyrics"),
  };
}

function screenshotTarget(): string | null {
  const fromArg = process.argv.find((arg) => arg.startsWith("--screenshot="));
  if (fromArg) return path.resolve(fromArg.slice("--screenshot=".length));
  const fromEnv = process.env["CZ_SCREENSHOT"];
  return fromEnv ? path.resolve(fromEnv) : null;
}

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#08090d",
    title: "Cadenza",
    icon: path.join(APP_ROOT, "resources", "icon.png"),
    webPreferences: {
      preload: path.join(APP_ROOT, "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.on("maximize", () => win.webContents.send("window:maximized-changed", true));
  win.on("unmaximize", () => win.webContents.send("window:maximized-changed", false));

  // Never let the renderer navigate away or spawn windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://cadenza/")) event.preventDefault();
  });

  await win.loadURL(RENDERER_URL);
  if (process.argv.includes("--dev")) win.webContents.openDevTools({ mode: "detach" });
  return win;
}

async function bootstrap(): Promise<void> {
  const appPaths = paths();
  const settings = new SettingsStore(path.join(appPaths.userData, "settings.json"));
  await settings.load();

  registerProtocols({ webRoot: WEB_ROOT, pluginDir: appPaths.plugins });

  const ctx: AppContext = {
    window: () => mainWindow,
    settings,
    paths: appPaths,
    tracks: [],
    scannedAt: null,
    send: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    },
  };

  registerIpc(ctx);

  const push = (command: HostCommand): void => sendCommand(ctx, command);
  buildMenu({
    isDev,
    send: push,
    openRepository: () => void shell.openExternal("https://github.com/FanDuck/cadenza"),
    openIssues: () => void shell.openExternal("https://github.com/FanDuck/cadenza/issues"),
  });
  if (settings.settings().mediaKeys) disposeMediaKeys = registerMediaKeys(push);

  mainWindow = await createWindow();

  // Windows thumbar buttons: play/pause, previous, next.
  installThumbar(mainWindow, push);

  const shot = screenshotTarget();
  if (shot) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const image = await mainWindow.webContents.capturePage();
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    fs.writeFileSync(shot, image.toPNG());
    // eslint-disable-next-line no-console
    console.log(`[cadenza] screenshot written to ${shot}`);
    app.exit(0);
    return;
  }

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow().then((win) => (mainWindow = win));
  });
}

function installThumbar(win: BrowserWindow, push: (command: HostCommand) => void): void {
  const icon = (name: string): Electron.NativeImage | null => {
    const file = path.join(APP_ROOT, "resources", "taskbar", `${name}.png`);
    if (!fs.existsSync(file)) return null;
    const image = nativeImage.createFromPath(file);
    return image.isEmpty() ? null : image;
  };

  const previous = icon("previous");
  const play = icon("play");
  const next = icon("next");
  if (!previous || !play || !next) return;

  try {
    win.setThumbarButtons([
      { tooltip: "Previous", icon: previous, click: () => push("previous") },
      { tooltip: "Play / Pause", icon: play, click: () => push("play-pause") },
      { tooltip: "Next", icon: next, click: () => push("next") },
    ]);
  } catch {
    /* thumbar is a nice-to-have */
  }
}

app.whenReady().then(() => {
  bootstrap().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[cadenza] failed to start", error);
    app.exit(1);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  disposeMediaKeys?.();
  disposeMediaKeys = null;
});

process.on("uncaughtException", (error) => {
  // eslint-disable-next-line no-console
  console.error("[cadenza] uncaught exception", error);
});
