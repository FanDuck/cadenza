# Roadmap

Cadenza is a framework first: the reference player exists to prove the framework is
good enough. Anything in this list is open for contribution.

## v0.1 — foundation (current)

- [x] Core engine: queue, player state machine, library with search and grouping
- [x] Metadata: MP3 (ID3v2.2/2.3/2.4), FLAC, Ogg Vorbis, Opus, MP4/M4A, WAV
- [x] Synced lyrics (LRC), M3U/M3U8/PLS import, M3U export
- [x] UI kit: 9 `<cz-*>` Web Components, three themes, theme tokens
- [x] Plugin API: commands, UI slots, player/library facades, scoped settings, theme vars
- [x] Reference desktop app: library, albums, artists, playlists, now playing, queue,
      command palette, keyboard shortcuts, media keys, Windows taskbar integration
- [x] Browser demo with sample data

## v0.2 — packaging and polish

- [x] `electron-builder` NSIS installer, portable exe and zip, built and attached to
      GitHub releases by CI on every `v*` tag
- [ ] Code signing certificate, so SmartScreen stops warning
- [ ] Windows System Media Transport Controls (SMTC) so the OS media flyout shows
      artwork and track metadata
- [ ] Gapless playback and crossfade
- [ ] ReplayGain / normalisation
- [ ] Virtualised track list for 50k+ libraries
- [ ] Drag & drop files and folders onto the window

## v0.3 — library intelligence

- [ ] Incremental rescans (watch folders, only re-read changed files)
- [ ] Duplicate detection
- [ ] Smart playlists (rules over metadata)
- [ ] Album artist / compilation handling, multi-disc ordering
- [ ] Embedded lyrics (USLT / SYLT) extraction

## v0.4 — framework maturity

- [ ] Publish `@fanduck/cadenza-core` and `@fanduck/cadenza-ui` to npm
- [ ] Stable plugin API with a version-negotiation handshake and a typed SDK package
- [ ] Plugin marketplace page in Settings
- [ ] Web Audio backend: equaliser, spatial audio, visualiser feeds
- [ ] Headless mode: drive the core from the command line

## Never

- Accounts, telemetry, ads, "cloud" requirements
- A bundler or a UI framework in the critical path
- Blocking the UI thread for library scans
