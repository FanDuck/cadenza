# Embedding the core

`@fanduck/cadenza-core` has no DOM dependency, no Electron dependency and no
framework dependency. That means you can drop it into a web page, an Electron app,
a Tauri app or a CLI, and build the player *you* want on top of it.

The reference desktop app is just one consumer.

## 30-line player in a browser

```html
<!doctype html>
<meta charset="utf-8" />
<button id="play">Play</button>
<p id="now">Nothing playing</p>

<script type="module">
  import { HtmlAudioSink, Player, parseMetadata, bufferSource } from "@fanduck/cadenza-core";

  // 1. An audio sink. Swap this for WebAudio, a remote stream, a DAW engine...
  const sink = new HtmlAudioSink();

  // 2. The player owns the queue, the transport state and the event bus.
  const player = new Player(sink, {
    resolveUrl: (track) => `/media/${encodeURIComponent(track.path)}`,
  });

  player.bus.on("player:snapshot", (snapshot) => {
    document.querySelector("#now").textContent = snapshot.track
      ? `${snapshot.track.title} — ${Math.floor(snapshot.position)}s / ${Math.floor(snapshot.duration)}s`
      : "Nothing playing";
  });

  const response = await fetch("/tracks.json");
  player.enqueue(await response.json());

  document.querySelector("#play").addEventListener("click", () => void player.toggle());
</script>
```

## Reading tags without the player

`parseMetadata` works on any random-access byte source, so you can read tags from a
`File`, a `fetch` Range request, or the local disk:

```ts
import { parseMetadata, bufferSource } from "@fanduck/cadenza-core";

const file = input.files[0];
const bytes = new Uint8Array(await file.arrayBuffer());
const meta = await parseMetadata(bufferSource(bytes), file.name);
// { title, artist, album, duration, bitrate, sampleRate, codec, cover? }
```

Supported: MP3 (ID3v2.2/2.3/2.4), FLAC, Ogg Vorbis, Opus, MP4/M4A (AAC & ALAC),
WAV. Malformed files never throw — you get whatever could be parsed, with
`duration: 0` when the length is unknown.

## Replacing the audio backend

Implement `AudioSink` (six methods, three getters, one `on()`):

```ts
import type { AudioSink, Track } from "@fanduck/cadenza-core";

class WebAudioSink implements AudioSink {
  private ctx = new AudioContext();
  private source: AudioBufferSourceNode | null = null;
  // load(): decodeAudioData → buffer; play(): start(0, offset)
  // ... see packages/core/src/sinks/html-audio.ts for the full contract
}
```

Emit `"timeupdate"`, `"ended"` and `"error"` and the player does the rest —
repeat, shuffle, gapless bookkeeping, taskbar progress, everything.

## Replacing the UI

`@fanduck/cadenza-ui` exports the `<cz-*>` custom elements, but nothing forces you to
use them. Import the core, render your own markup, and keep the same CSS tokens if
you want the built-in themes to keep working.

```ts
import { defineCadenzaElements } from "@fanduck/cadenza-ui";

defineCadenzaElements(); // registers every <cz-*> tag once
```

## Persistence

`Player` is stateless; `Library` takes any `KeyValueStore`:

```ts
import { Library, MemoryStore } from "@fanduck/cadenza-core";

const library = new Library(new MemoryStore(JSON.parse(localStorage.getItem("lib") ?? "{}")));
await library.load();
// ... on quit:
await library.save();
localStorage.setItem("lib", JSON.stringify(/* your serialized store */));
```

`MemoryStore` is a working implementation, so tests need nothing more.

## What is *not* in core

Deliberately:

- file system access (pass a `ByteSource` instead)
- HTTP (pass URLs to your sink)
- scanning policy (folders to walk, ignore lists)
- UI and keyboard shortcuts

Those belong to the host application. That line is why the same engine runs in
Electron, in a browser tab and in tests.
