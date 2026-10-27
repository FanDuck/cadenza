/**
 * Native application menu + global media keys.
 *
 * Media keys are the reason the app feels native on Windows: they work even
 * when Cadenza is in the background.
 */

import { app, globalShortcut, Menu, type MenuItemConstructorOptions } from "electron";
import type { HostCommand } from "../shared/ipc.js";

export interface MenuOptions {
  isDev: boolean;
  send: (command: HostCommand) => void;
  openRepository: () => void;
  openIssues: () => void;
}

export function buildMenu(options: MenuOptions): void {
  const { send } = options;

  const template: MenuItemConstructorOptions[] = [
    {
      label: "&File",
      submenu: [
        { label: "Add music folder…", accelerator: "CmdOrCtrl+O", click: () => send("focus-search") },
        { type: "separator" },
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => send("open-settings") },
        { type: "separator" },
        { role: "quit", label: "Quit Cadenza" },
      ],
    },
    {
      label: "&Playback",
      submenu: [
        { label: "Play / Pause", accelerator: "Space", click: () => send("play-pause") },
        { label: "Next track", accelerator: "CmdOrCtrl+Right", click: () => send("next") },
        { label: "Previous track", accelerator: "CmdOrCtrl+Left", click: () => send("previous") },
        { label: "Stop", click: () => send("stop") },
        { type: "separator" },
        { label: "Show queue", accelerator: "CmdOrCtrl+Q", click: () => send("toggle-queue") },
      ],
    },
    {
      label: "&View",
      submenu: [
        { label: "Search", accelerator: "CmdOrCtrl+F", click: () => send("focus-search") },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(options.isDev ? ([{ role: "toggleDevTools" }, { role: "reload" }] as MenuItemConstructorOptions[]) : []),
      ],
    },
    {
      label: "&Help",
      submenu: [
        { label: "Cadenza on GitHub", click: options.openRepository },
        { label: "Report an issue", click: options.openIssues },
        { type: "separator" },
        { label: "Plugin API documentation", click: options.openRepository },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Register media keys. Returns a disposer so settings can toggle them. */
export function registerMediaKeys(send: (command: HostCommand) => void): () => void {
  const bindings: Array<[string, HostCommand]> = [
    ["MediaPlayPause", "play-pause"],
    ["MediaNextTrack", "next"],
    ["MediaPreviousTrack", "previous"],
    ["MediaStop", "stop"],
  ];

  const registered: string[] = [];
  for (const [accelerator, command] of bindings) {
    try {
      if (globalShortcut.register(accelerator, () => send(command))) registered.push(accelerator);
    } catch {
      // Another app may already own a key; that is fine.
    }
  }

  return () => {
    for (const accelerator of registered) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        /* ignore */
      }
    }
  };
}
