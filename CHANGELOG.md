# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-27

First public release: a framework, a UI kit, and a reference player.

### Added

- **Core engine** (`@fanduck/cadenza-core`)
  - `Player` state machine over an injectable `AudioSink`, with shuffle, repeat
    off/all/one and race-safe `next`/`ended` handling
  - `Queue` with insert/remove/move, deterministic shuffled order and index stability
  - `Library` with diacritic-insensitive search, grouping by album/artist, pagination
    and JSON persistence through any `KeyValueStore`
  - `EventBus` with typed events and listener-error isolation
- **Metadata readers** for MP3 (ID3v2.2/2.3/2.4, including APIC cover art), FLAC
  (STREAMINFO, Vorbis comments, PICTURE), Ogg Vorbis, Opus, MP4/M4A (AAC and ALAC
  atoms, `covr`), and WAV — all bounds-checked, none of them throw on malformed files
- **Formats**: LRC parser/serialiser with offset and multi-timestamp support, M3U,
  M3U8 and PLS import, M3U export
- **Plugin system**: folder-based plugins with a manifest, command registration, four
  UI slots, player/library facades, namespaced settings and runtime theme variables
- **UI kit** (`@fanduck/cadenza-ui`): `cz-icon`, `cz-slider`, `cz-cover`,
  `cz-track-list`, `cz-now-playing`, `cz-visualizer`, `cz-lyrics`, `cz-empty-state`,
  `cz-toast-host`, plus the shared theme token sheet
- **Desktop app**: library scanning in the main process with progress reporting,
  `app://` / `cadenza-media://` / `cadenza-plugin://` protocols with range support,
  frameless window, native menu, media keys, taskbar progress and thumbar buttons
- **Reference UI**: library, albums, artists, playlists, now playing, queue panel,
  command palette, keyboard shortcuts, three themes
- **Browser demo** (`pnpm demo`) with sample data, no audio files required
- **Docs**: architecture, plugin API, theming, embedding guide, roadmap
- **Examples**: `hello-world` and `accent-cycle` plugins

[Unreleased]: https://github.com/FanDuck/cadenza/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/FanDuck/cadenza/releases/tag/v0.1.0
