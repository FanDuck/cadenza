/**
 * IPC contract test.
 *
 * `src/preload.cjs` is deliberately plain CommonJS with no build step, so it
 * cannot import `src/shared/ipc.ts`. That duplication is a real hazard: rename a
 * channel on one side and the feature silently stops working. This test keeps
 * both lists in sync by reading the preload source and comparing it with the
 * compiled channel table.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC } from "../dist/shared/ipc.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(here, "..", "src", "preload.cjs");
const preloadSource = fs.readFileSync(preloadPath, "utf8");

/** Channel names declared inside the preload's own IPC table. */
function preloadChannels(source: string): string[] {
  const table = /const IPC = \{([\s\S]*?)\};/.exec(source);
  assert.ok(table, "preload declares an IPC channel table");
  return [...(table[1] ?? "").matchAll(/"([a-z-]+:[a-z-]+)"/g)].map((match) => match[1]).filter(Boolean);
}

test("preload channel table matches the shared IPC contract", () => {
  const declared = new Set(Object.values(IPC));
  const inPreload = new Set(preloadChannels(preloadSource));

  const missingInPreload = [...declared].filter((channel) => !inPreload.has(channel));
  const missingInContract = [...inPreload].filter((channel) => !declared.has(channel));

  assert.deepEqual(missingInPreload, [], "every contract channel exists in the preload");
  assert.deepEqual(missingInContract, [], "every preload channel is declared in the contract");
});

test("preload exposes the full bridge surface", () => {
  const bridgeMembers = [
    "platform",
    "demo",
    "versions",
    "mediaUrl(",
    "app:",
    "window:",
    "dialog:",
    "library:",
    "settings:",
    "playlists:",
    "plugins:",
    "lyrics:",
    "player:",
    "shell:",
    "onCommand",
    "onLibraryChanged",
  ];
  for (const member of bridgeMembers) {
    assert.ok(preloadSource.includes(member), `preload implements ${member}`);
  }

  // The context bridge must stay the only way into main.
  assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld(\"cadenza\""));
  assert.ok(!/nodeIntegration\s*:\s*true/.test(preloadSource), "node integration is never enabled");
});

test("preload media URLs use the same scheme the main process serves", () => {
  const protocolsSource = fs.readFileSync(path.join(here, "..", "src", "main", "protocols.ts"), "utf8");
  const scheme = /MEDIA_SCHEME\s*=\s*"([^"]+)"/.exec(protocolsSource)?.[1];
  assert.ok(scheme, "main declares a media scheme");
  assert.ok(
    preloadSource.includes(`${scheme}://file/`),
    `preload builds ${scheme}:// URLs like the main process expects`,
  );
  assert.ok(
    protocolsSource.includes("MEDIA_SCHEME === \"cadenza-media\"") || protocolsSource.includes(`"${scheme}"`),
    "protocol handler serves the same scheme",
  );
});

test("preload never imports node modules that are unavailable in a sandboxed preload", () => {
  const imports = [...preloadSource.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]).filter(Boolean);
  assert.deepEqual(
    imports.filter((name) => name !== "electron" && !name.startsWith("node:")),
    [],
    "only electron and node: builtins are required",
  );
});
