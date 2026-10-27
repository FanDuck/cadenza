# Plugin API

Cadenza is built so that everything the reference player does, a plugin can do too —
without forking it and without a build step.

A plugin is a **folder with a manifest and a JavaScript file**. That's it.

```
%APPDATA%\Cadenza\plugins\my-plugin\
├── cadenza.plugin.json
└── index.js
```

Click **Settings → Plugins → Reload plugins**, or restart Cadenza.

---

## 1. The manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "What it does, in one sentence.",
  "author": "Your Name",
  "main": "index.js",
  "cadenza": "^0.1.0"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | ✅ | Unique, lowercase, `a-z 0-9 . _ -`. Used for settings namespacing and logs. |
| `name` | ✅ | Shown in the plugin list. |
| `version` | ✅ | Semver of your plugin. |
| `main` | ✅ | Entry file, relative to the folder. ES module. |
| `description` | | One sentence. |
| `author` | | Your name or handle. |
| `cadenza` | | Semver range of Cadenza you support, e.g. `^0.1.0`. |

The folder name must match `id` for the entry URL to resolve.

## 2. The module

```js
export default {
  activate(ctx) {
    // register commands, UI, listeners
  },
  deactivate() {
    // optional: clean up anything you created by hand
  },
};
```

`activate` may be `async`. Anything you register through `ctx` is disposed
automatically when the plugin is unloaded — `deactivate()` is only for resources
you created yourself (timers, `fetch` abort controllers, audio nodes...).

A plugin that throws during `activate` is marked **error** in the plugin list and
the rest of the app keeps running. One broken plugin must never break the player.

## 3. The context

### `ctx.player`

```ts
ctx.player.snapshot()                       // PlayerSnapshot
await ctx.player.play(track?)               // play a track, or toggle the queue
ctx.player.pause()
await ctx.player.next()
await ctx.player.previous()
ctx.player.seek(42.5)                       // seconds
ctx.player.setVolume(0.6)                   // 0..1
ctx.player.enqueue(tracks)                  // append to the queue

const sub = ctx.player.on("trackchange", (snapshot) => { ... });
sub.dispose();                              // or just let unload clean it up
```

Events: `"trackchange"`, `"statechange"`, `"position"`.

### `ctx.library`

```ts
ctx.library.tracks()          // Track[]
ctx.library.search("aurora")  // Track[]

const sub = ctx.library.on("change", (snapshot) => { ... });
```

The library is read-only for plugins: Cadenza owns scanning. To add virtual tracks,
put them in the queue with `ctx.player.enqueue()`.

### `ctx.commands`

Every command shows up in the command palette (`Ctrl+K`) and is searchable by
`title` and `keywords`.

```ts
const sub = ctx.commands.register({
  id: "my-plugin.do-something",
  title: "My Plugin: do something",
  keywords: ["magic"],
  shortcut: "Ctrl+Alt+M",   // displayed only; binding is the app's job
  async run() {
    // ...
  },
});
```

### `ctx.ui.slot(name, render)`

Slots are the extension points of the reference UI:

| Slot | Where it renders |
| --- | --- |
| `sidebar:footer` | Bottom of the left sidebar, under the nav |
| `now-playing:action` | Next to the transport controls |
| `settings:section` | An extra card in Settings |

Track rows live inside the UI kit's shadow DOM, so there is no per-row slot;
use `now-playing:action` or a command instead.

```ts
ctx.ui.slot("sidebar:footer", (host) => {
  const button = document.createElement("button");
  button.textContent = "Do the thing";
  button.addEventListener("click", () => { /* ... */ });
  host.append(button);
});
```

`host` is a plain `<div>` that already lives in the layout. Anything you append is
removed when the plugin unloads. Style it with the theme variables (`var(--cz-*)`),
not with hard-coded colours.

### `ctx.settings`

Scoped storage: your keys are stored under `plugin.<id>.*`, so two plugins can both
use `"enabled"` without colliding.

```ts
const limit = ctx.settings.get("limit", 25);
ctx.settings.set("limit", 50);
```

### `ctx.theme`

```ts
const undo = ctx.theme.setVar("--cz-accent", "#ff6b6b");
undo.dispose();  // restores the previous value
```

### `ctx.log(...)`

Prefixes messages with `[plugin:<id>]` in DevTools.

## 4. A complete example

See [`examples/plugins/hello-world`](../examples/plugins/hello-world) — a command,
a sidebar button and a playback listener in ~50 lines — and
[`examples/plugins/accent-cycle`](../examples/plugins/accent-cycle) for the theme API.

## 5. Security model

Plugins run in the renderer with full page privileges. That is the same trust model
as a VS Code extension or a browser userscript:

- Installing a plugin means trusting its author.
- There is no sandbox and no permission prompt (yet).
- Plugins **cannot** open windows, navigate the app away, or reach Node APIs —
  the renderer has `nodeIntegration: false` and `contextIsolation: true`.

Only install plugins you have read.

## 6. Versioning promise

Within `0.x`, the plugin API can change in a minor release. Every breaking change is
listed in [CHANGELOG.md](../CHANGELOG.md) with a migration note, and `manifest.cadenza`
lets the host refuse to load a plugin that declares an incompatible range.
