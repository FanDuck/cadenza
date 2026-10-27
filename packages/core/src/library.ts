/**
 * The library: the set of tracks Cadenza knows about, with filtering, sorting,
 * grouping and optional persistence through a {@link KeyValueStore}.
 */

import { EventBus } from "./events.js";
import type { CoreEvents, KeyValueStore, LibraryQuery, LibrarySnapshot, SortKey, Track, TrackId } from "./types.js";

/** Tracks that share an album, grouped for album grids. */
export interface AlbumGroup {
  album: string;
  albumArtist: string;
  year?: number;
  coverId?: string;
  tracks: Track[];
}

/** Per-artist aggregate used by artist grids. */
export interface ArtistGroup {
  artist: string;
  trackCount: number;
  albums: number;
}

/** Store key holding the persisted library. */
const LIBRARY_STORAGE_KEY = "library";
/** Coalesce bursts of mutations (e.g. a bulk upsert) into one change event. */
const CHANGE_DEBOUNCE_MS = 16;

interface StoredLibrary {
  tracks: Track[];
  scannedAt: number | null;
}

/**
 * Track library with in-memory indexes.
 *
 * Mutations emit `library:change` on the bus. Emissions are debounced, and
 * {@link save} always flushes a pending emission before persisting.
 */
export class Library {
  /** Bus used for `library:change` events. */
  readonly bus: EventBus<CoreEvents>;

  private readonly store?: KeyValueStore;
  private list: Track[] = [];
  private readonly byId = new Map<TrackId, Track>();
  private scannedAt: number | null = null;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param store - Optional persistence backend. Without one the library is
   * memory-only and `load()`/`save()` are no-ops.
   * @param bus - Optional shared event bus. A private one is created when omitted.
   */
  constructor(store?: KeyValueStore, bus?: EventBus<CoreEvents>) {
    this.store = store;
    this.bus = bus ?? new EventBus<CoreEvents>();
  }

  /** Snapshot used by `library:change` consumers. */
  get snapshot(): LibrarySnapshot {
    return { tracks: this.list.slice(), total: this.list.length, scannedAt: this.scannedAt };
  }

  /**
   * Live track array (the library owns it). Treat it as read-only and prefer
   * {@link snapshot} or {@link query} when you need to hand tracks elsewhere.
   */
  get tracks(): Track[] {
    return this.list;
  }

  /**
   * Replace the whole library, e.g. after a scan.
   *
   * @param scannedAt - Epoch millis of the scan; defaults to now.
   */
  replaceAll(tracks: Track[], scannedAt: number = Date.now()): void {
    this.list = dedupeById(tracks);
    this.rebuildIndex();
    this.scannedAt = scannedAt;
    this.scheduleChange();
  }

  /** Insert or replace tracks, deduplicated by `Track.id`. */
  upsert(tracks: Track[]): void {
    if (tracks.length === 0) return;
    const positions = new Map<TrackId, number>();
    for (let i = 0; i < this.list.length; i++) {
      const existing = this.list[i];
      if (existing) positions.set(existing.id, i);
    }
    for (const track of tracks) {
      const position = positions.get(track.id);
      if (position === undefined) {
        positions.set(track.id, this.list.length);
        this.list.push(track);
      } else {
        this.list[position] = track;
      }
      this.byId.set(track.id, track);
    }
    this.scheduleChange();
  }

  /** Remove a single track by id. Unknown ids are ignored. */
  remove(id: TrackId): void {
    const track = this.byId.get(id);
    if (!track) return;
    this.byId.delete(id);
    const index = this.list.indexOf(track);
    if (index >= 0) this.list.splice(index, 1);
    this.scheduleChange();
  }

  /** Remove every track and forget the last scan time. */
  clear(): void {
    this.list = [];
    this.byId.clear();
    this.scannedAt = null;
    this.scheduleChange();
  }

  /**
   * Filter, sort and paginate the library. Text matching is case- and
   * diacritic-insensitive and covers title, artist, album and path.
   */
  query(query: LibraryQuery): Track[] {
    const text = normalize(query.text ?? "");
    const artist = query.artist === undefined ? null : normalize(query.artist);
    const album = query.album === undefined ? null : normalize(query.album);

    let result = this.list.filter((track) => {
      if (artist !== null && normalize(track.artist) !== artist) return false;
      if (album !== null && normalize(track.album) !== album) return false;
      if (text.length === 0) return true;
      const haystack = `${normalize(track.title)} ${normalize(track.artist)} ${normalize(track.album)} ${normalize(track.path)}`;
      return haystack.includes(text);
    });

    if (query.sortBy) {
      result.sort(compareBy(query.sortBy, query.sortDir ?? "asc"));
    }

    const offset = query.offset === undefined ? 0 : Math.max(0, Math.trunc(query.offset));
    const limit = query.limit === undefined ? null : Math.max(0, Math.trunc(query.limit));
    if (offset === 0 && limit === null) return result;
    return result.slice(offset, limit === null ? undefined : offset + limit);
  }

  /** Free-text shortcut for {@link query}. */
  search(text: string): Track[] {
    return this.query({ text });
  }

  /** Albums, sorted by name, with their tracks in disc/track order. */
  albums(): AlbumGroup[] {
    const groups = new Map<string, AlbumGroup>();
    for (const track of this.list) {
      const album = track.album.length > 0 ? track.album : "Unknown album";
      const albumArtist = track.albumArtist ?? (track.artist.length > 0 ? track.artist : "Unknown artist");
      const key = `${normalize(album)}\u0000${normalize(albumArtist)}`;
      let group = groups.get(key);
      if (!group) {
        group = { album, albumArtist, tracks: [] };
        groups.set(key, group);
      }
      group.tracks.push(track);
      if (group.year === undefined && track.year !== undefined) group.year = track.year;
      if (group.coverId === undefined && track.coverId !== undefined) group.coverId = track.coverId;
    }

    const collator = textCollator();
    const albums = [...groups.values()];
    albums.sort((a, b) => collator.compare(a.album, b.album) || collator.compare(a.albumArtist, b.albumArtist));
    for (const album of albums) {
      album.tracks.sort(
        (a, b) =>
          (a.discNo ?? 1) - (b.discNo ?? 1) ||
          (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
          collator.compare(a.title, b.title),
      );
    }
    return albums;
  }

  /** One entry per performing artist with track and album counts. */
  artists(): ArtistGroup[] {
    const groups = new Map<string, { artist: string; trackCount: number; albums: Set<string> }>();
    for (const track of this.list) {
      const artist = track.artist.length > 0 ? track.artist : "Unknown artist";
      const key = normalize(artist);
      let group = groups.get(key);
      if (!group) {
        group = { artist, trackCount: 0, albums: new Set<string>() };
        groups.set(key, group);
      }
      group.trackCount += 1;
      group.albums.add(normalize(track.album.length > 0 ? track.album : "Unknown album"));
    }

    const collator = textCollator();
    return [...groups.values()]
      .map((group) => ({ artist: group.artist, trackCount: group.trackCount, albums: group.albums.size }))
      .sort((a, b) => collator.compare(a.artist, b.artist));
  }

  /** Record that a track was played: bumps `playCount` and stamps `lastPlayedAt`. */
  markPlayed(id: TrackId): void {
    const track = this.byId.get(id);
    if (!track) return;
    track.playCount = (track.playCount ?? 0) + 1;
    track.lastPlayedAt = Date.now();
    this.scheduleChange();
  }

  /** Restore the persisted library (no-op without a store). */
  async load(): Promise<void> {
    if (!this.store) return;
    const stored = this.store.get<StoredLibrary | null>(LIBRARY_STORAGE_KEY, null);
    if (!stored || !Array.isArray(stored.tracks)) return;
    this.list = dedupeById(stored.tracks.filter(isTrackLike));
    this.rebuildIndex();
    this.scannedAt = typeof stored.scannedAt === "number" ? stored.scannedAt : null;
    this.bus.emit("library:change", this.snapshot);
  }

  /** Persist the library under the `"library"` store key. Flushes pending change events. */
  async save(): Promise<void> {
    this.flushPendingChange();
    if (!this.store) return;
    const payload: StoredLibrary = { tracks: this.list, scannedAt: this.scannedAt };
    this.store.set(LIBRARY_STORAGE_KEY, payload);
    await this.store.flush();
  }

  /* ------------------------------------------------------------ internals */

  private rebuildIndex(): void {
    this.byId.clear();
    for (const track of this.list) this.byId.set(track.id, track);
  }

  private scheduleChange(): void {
    if (this.changeTimer !== null) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.bus.emit("library:change", this.snapshot);
    }, CHANGE_DEBOUNCE_MS);
  }

  private flushPendingChange(): void {
    if (this.changeTimer === null) return;
    clearTimeout(this.changeTimer);
    this.changeTimer = null;
    this.bus.emit("library:change", this.snapshot);
  }
}

function dedupeById(tracks: Track[]): Track[] {
  const unique = new Map<TrackId, Track>();
  for (const track of tracks) unique.set(track.id, track);
  return [...unique.values()];
}

function isTrackLike(value: unknown): value is Track {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Track>;
  return typeof candidate.id === "string" && typeof candidate.path === "string";
}

/** Case- and diacritic-insensitive comparison key. */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function textCollator(): Intl.Collator {
  return new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
}

function compareBy(key: SortKey, direction: "asc" | "desc"): (a: Track, b: Track) => number {
  const sign = direction === "desc" ? -1 : 1;
  const collator = textCollator();
  return (a, b) => {
    let result: number;
    switch (key) {
      case "title":
        result = collator.compare(a.title, b.title);
        break;
      case "artist":
        result = collator.compare(a.artist, b.artist);
        break;
      case "album":
        result = collator.compare(a.album, b.album);
        break;
      case "albumArtist":
        result = collator.compare(a.albumArtist ?? a.artist, b.albumArtist ?? b.artist);
        break;
      case "added":
        result = a.addedAt - b.addedAt;
        break;
      case "duration":
        result = a.duration - b.duration;
        break;
      case "year":
        result = (a.year ?? 0) - (b.year ?? 0);
        break;
      default:
        result = 0;
    }
    return result * sign;
  };
}
