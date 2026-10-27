# Cadenza architecture

Cadenza is a **framework**, not just a player. The reference app is one consumer of it.

```
┌─────────────────────────────────────────────────────────────────────┐
│ apps/desktop  (Electron)                                            │
│   main      window, app:// protocol, library scanning, plugins,     │
│             media keys, taskbar integration, settings file          │
│   preload   the only bridge between main and renderer (CJS)         │
│   renderer  the reference UI: layout, views, keyboard, state glue   │
└───────────────┬──────────────────────────────┬──────────────────────┘
                │                              │
      ┌─────────▼─────────┐          ┌─────────▼─────────┐
      │ @fanduck/         │          │ @fanduck/         │
      │ cadenza-core      │          │ cadenza-ui        │
      │                   │          │                   │
      │ EventBus          │          │ <cz-*> Web        │
      │ Player + Queue    │          │ Components        │
      │ Library           │          │ theme.css tokens  │
      │ metadata readers  │          │ shared styles     │
      │ LRC / M3U / PLS   │          │                   │
      │ PluginHost        │          │                   │
      └───────────────────┘          └───────────────────┘
```

## Design rules

1. **Core never imports Electron, Node or the DOM** (except the optional `HtmlAudioSink`,
   which only needs `HTMLAudioElement` so it works in a browser too).
   Everything environment-specific is injected: a `ByteSource` for metadata, an
   `AudioSink` for playback, a `KeyValueStore` for persistence.
2. **UI never imports Electron.** The renderer talks to the host through the
   `CadenzaBridge` interface in `apps/desktop/src/shared/ipc.ts`. When that
   interface is missing (plain browser), the app falls back to a demo bridge.
3. **No bundler.** Sources are compiled with `tsc` and loaded as native ES modules.
   The renderer is served from a custom `app://` protocol so ES modules work, and
   imports of workspace packages are resolved with an import map in `index.html`.
   This keeps the project readable for people who are new to programming.
4. **Widgets are custom elements** with explicit `update()`-style setters instead of
   attribute-only APIs, because a music player pushes high-frequency state (position,
   analyser frames) that must not re-render whole trees.
5. **Everything user-visible is themeable** through CSS custom properties declared
   in `packages/ui/src/theme.css`. Plugins may override tokens at runtime.

## Data flow

```
user gesture ──> renderer ──> Player (core) ──> AudioSink ──> <audio> / WebAudio
                    │              │
                    │              └── emits "player:snapshot" on every change
                    └── Library.query() / PluginHost slots
```

Library scanning happens in the **main** process (it has `fs`):

```
renderer.library.scan(roots)
   └─> main walks folders, reads tags, extracts covers
       ├─ streams "library:scan-progress" events back to the renderer
       └─ resolves with Track[]  ──> renderer merges into Library (core)
```

## Package boundaries

| Package | May depend on | Must not depend on |
| --- | --- | --- |
| `@fanduck/cadenza-core` | nothing | electron, node:fs (except types), DOM (except `HtmlAudioSink`) |
| `@fanduck/cadenza-ui` | core (types only) | electron, node |
| `apps/desktop` | core, ui | — |

## Plugin model

A plugin is a folder inside `<userData>/plugins/<id>/`:

```
my-plugin/
  cadenza.plugin.json     { id, name, version, main, cadenza }
  index.js                export default { activate(ctx), deactivate() }
```

The main process serves the folder over `cadenza-plugin://<id>/`, the renderer
`import()`s `main`, and hands the module a `PluginContext` (player facade, library
queries, command registry, UI slots, scoped settings, theme variables). A failing
plugin is isolated: it is marked `error` and reported in the plugin list, never
taking the app down.

## Threads and processes

* Main process: filesystem, dialogs, protocols, native menus, media keys.
* Renderer: all UI, the `Player`, the `Library`, plugins.
* `Player` runs on the renderer's main thread; decay of `player:snapshot` events is
  throttled to the animation frame rate by the UI, not by the player.
