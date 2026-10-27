/**
 * Cadenza core - the UI-agnostic engine behind the player.
 *
 * Public surface is intentionally small: a handful of classes, a metadata
 * reader, format parsers and the plugin system.
 */

export * from "./types.js";

export { EventBus } from "./events.js";

export { Queue } from "./queue.js";
export { Player } from "./player.js";
export { Library, type AlbumGroup, type ArtistGroup } from "./library.js";

export { parseMetadata, describeCodec, guessCodec } from "./metadata/index.js";
export { bufferSource } from "./metadata/source.js";

export { HtmlAudioSink } from "./sinks/html-audio.js";

export { parseLrc, findActiveLine, serializeLrc } from "./lyrics/lrc.js";

export { parseM3u, serializeM3u, parsePls, detectPlaylistFormat } from "./playlists/index.js";

export { PluginHost } from "./plugins/host.js";
export type { PluginModule } from "./plugins/host.js";

export { createPluginContext } from "./plugins/context.js";

export { formatTime, formatDuration, formatBytes, hashId, clamp } from "./util/format.js";

export { MemoryStore } from "./store/memory.js";
