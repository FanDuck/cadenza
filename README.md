<div align="center">

<img src="docs/assets/banner.png" alt="Cadenza - a plugin-first music player framework for Windows" width="100%" />

# Cadenza

**A plugin-first music player framework for Windows.**

[![CI](https://github.com/FanDuck/cadenza/actions/workflows/ci.yml/badge.svg)](https://github.com/FanDuck/cadenza/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-8b5cf6.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-22d3ee.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4.svg)](#requirements)
[![No bundler](https://img.shields.io/badge/build-tsc%20only-success.svg)](docs/ARCHITECTURE.md)

[Quick start](#quick-start) · [Features](#features) · [Write a plugin](#write-your-first-plugin) · [Architecture](docs/ARCHITECTURE.md) · [Docs](#documentation) · [中文说明](README.zh-CN.md)

</div>

---

Cadenza is two things at once:

1. **A framework.** `@fanduck/cadenza-core` is a UI-agnostic engine — queue, player state
   machine, library, tag parsing, lyrics, playlists, and a plugin host. It has no DOM,
   no Electron and no framework dependency. Drop it into your own app and build the
   player *you* want.
2. **A player.** `apps/desktop` is a complete, themeable Windows desktop player built on
   that engine — the reference implementation, and the proof that the framework is good
   enough to ship.

Most music players are sealed boxes. Cadenza is meant to be opened: plugins get the same
powers as the built-in UI, and the UI itself is replaceable.

## Features

**Playback**
- MP3, FLAC, WAV, M4A/M4B (AAC & ALAC), Ogg Vorbis, Opus — with full tag support.
  AIFF and WMA are scanned and playable when the codec is available, but their tags
  are not parsed yet
- Shuffle, repeat off/all/one, seek with keyboard, volume, mute
- Media keys, Windows taskbar progress and thumbnail-toolbar buttons
- Restores your queue, volume, shuffle and repeat mode on startup

**Library**
- Recursive folder scanning in the main process — the UI never blocks
- Tag reading written from scratch (no native modules): ID3v2.2/2.3/2.4, Vorbis comments,
  MP4 atoms, RIFF/WAVE, with embedded cover art extracted and cached
- Diacritic-insensitive search across title, artist, album and path
- Album and artist views, sorting, filtering

**Extras**
- Synced lyrics from `.lrc` sidecar files, with click-to-seek
- M3U/M3U8/PLS import, M3U export
- Command palette (`Ctrl+K`) that plugins extend
- Spectrum visualiser
- Three built-in themes and a token-based theme API

**For developers**
- Zero bundler: `tsc` and native ES modules, nothing else
- 9 `<cz-*>` Web Components with Shadow DOM, keyboard support and ARIA
- Plugin API with UI slots, commands, player/library facades, scoped settings
- 93+ unit tests on the core, run with `node --test`

## Requirements

- Windows 10 or 11 (the desktop app uses Electron; the core also runs in browsers)
- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io) 9+

## Quick start

```powershell
git clone https://github.com/FanDuck/cadenza.git
cd cadenza
pnpm install
pnpm start
```

`pnpm start` builds everything and opens the player. Then click **Add music folder**,
pick a folder of audio files, and press play.

No Node yet? Install it from [nodejs.org](https://nodejs.org) (LTS), then run
`npm install -g pnpm`. That is the whole toolchain.

### Try it without installing anything

```powershell
pnpm demo
```

Opens the same UI in your browser with sample data — no audio files, no Electron.
Handy for screenshots and for front-end work.

### Screenshot

```powershell
pnpm screenshot
```

Writes `screenshots/app.png` from a real, running window. (The README screenshots are
produced with this command.)

## Write your first plugin

Create a folder in `%APPDATA%\Cadenza\plugins\my-plugin\`:

```json
// cadenza.plugin.json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "main": "index.js",
  "cadenza": "^0.1.0"
}
```

```js
// index.js
export default {
  activate(ctx) {
    ctx.commands.register({
      id: "my-plugin.greet",
      title: "My Plugin: greet me",
      run() {
        const track = ctx.player.snapshot().track;
        ctx.log(track ? `Playing ${track.title}` : "Nothing playing");
      },
    });

    ctx.ui.slot("sidebar:footer", (host) => {
      const button = document.createElement("button");
      button.textContent = "Wave";
      button.addEventListener("click", () => ctx.log("hello"));
      host.append(button);
    });
  },
};
```

Click **Settings → Plugins → Reload plugins**. No build step, no dependencies.

Two working examples live in [`examples/plugins`](examples/plugins):
[`hello-world`](examples/plugins/hello-world) (commands, slots, listeners) and
[`accent-cycle`](examples/plugins/accent-cycle) (runtime theme variables).

Full reference: [docs/PLUGIN_API.md](docs/PLUGIN_API.md).

## Build your own player

The core does not care what you render with:

```ts
import { HtmlAudioSink, Player } from "@fanduck/cadenza-core";

const player = new Player(new HtmlAudioSink());
player.bus.on("player:snapshot", (s) => {
  console.log(s.track?.title, s.position, s.duration);
});
player.enqueue(tracks);
await player.play();
```

Swap `HtmlAudioSink` for your own `AudioSink` (WebAudio, a remote stream, a DAW) and the
queue, repeat/shuffle and state machine keep working. See
[docs/EMBEDDING.md](docs/EMBEDDING.md).

## Theme it

Every colour is a CSS custom property. A theme is a JSON file of overrides:

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "vars": {
    "--cz-bg": "#0b0b14",
    "--cz-accent": "#ff7ac6",
    "--cz-grad": "linear-gradient(135deg,#ff7ac6,#7c5cff)"
  }
}
```

Built in: **Midnight** (default), **Daylight**, **Synthwave**. See
[docs/THEMING.md](docs/THEMING.md).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Seek ∓5s |
| `Ctrl+←` / `Ctrl+→` | Previous / next track |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `S` | Shuffle |
| `R` | Cycle repeat mode |
| `Ctrl+F` | Focus search |
| `Ctrl+K` | Command palette |
| `Ctrl+Q` | Toggle queue panel |
| `Esc` | Close overlay |

## Project layout

```
packages/core     engine: queue, player, library, tags, lyrics, playlists, plugins
packages/ui       <cz-*> Web Components + theme tokens
apps/desktop      Electron main + preload + reference renderer
examples/         sample plugins
docs/             architecture, plugin API, theming, embedding, roadmap
scripts/          build (tsc API, no bundler), demo server, asset generators
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Compile every package |
| `pnpm start` | Build and launch the player |
| `pnpm dev` | Same, with DevTools |
| `pnpm demo` | Browser demo with sample data |
| `pnpm test` | Build, then run all tests |
| `pnpm typecheck` | Types only |
| `pnpm screenshot` | Save `screenshots/app.png` |

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, and the rules that keep them apart |
| [PLUGIN_API.md](docs/PLUGIN_API.md) | Manifest, context, slots, commands, lifecycle |
| [THEMING.md](docs/THEMING.md) | Token list, theme files, runtime overrides |
| [EMBEDDING.md](docs/EMBEDDING.md) | Use the core in your own app |
| [ROADMAP.md](docs/ROADMAP.md) | What is planned |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, conventions, PR checklist |

## Status

**0.1.0 — usable, pre-1.0.** Playback, library, lyrics, playlists, themes and the plugin
API work. Packaging an installer is the next milestone; for now run from source
(see [ROADMAP](docs/ROADMAP.md)). Within `0.x`, minor versions may change the plugin API;
breaking changes get a migration note in the [changelog](CHANGELOG.md).

## Contributing

Bug reports, plugin ideas and pull requests are welcome — especially from people who are
new to programming. Read [CONTRIBUTING.md](CONTRIBUTING.md) and be kind
([CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)).

Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 FanDuck

The name "Cadenza" and the logo are used as project identity. Sample data and the
duck-eared note mark are original work.
