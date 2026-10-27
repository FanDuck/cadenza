/**
 * Library filtering/sorting/pagination, id deduplication, grouping, play
 * statistics and persistence through MemoryStore.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EventBus } from "../dist/events.js";
import { Library } from "../dist/library.js";
import { MemoryStore } from "../dist/store/memory.js";
import type { Track } from "../dist/types.js";

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    path: `C:/music/${id}.mp3`,
    title: `Title ${id}`,
    artist: "Artist",
    album: "Album",
    duration: 200,
    addedAt: 0,
    ...overrides,
  };
}

function sampleTracks(): Track[] {
  return [
    makeTrack("joga", {
      title: "Jóga",
      artist: "Björk",
      album: "Homogenic",
      albumArtist: "Björk",
      year: 1997,
      duration: 300,
      addedAt: 30,
      trackNo: 3,
      coverId: "cover-homogenic",
    }),
    makeTrack("windowlicker", {
      title: "Windowlicker",
      artist: "Aphex Twin",
      album: "Windowlicker",
      albumArtist: "Aphex Twin",
      year: 1999,
      duration: 360,
      addedAt: 10,
      trackNo: 1,
    }),
    makeTrack("xtal", {
      title: "Xtal",
      artist: "Aphex Twin",
      album: "Selected Ambient Works",
      albumArtist: "Aphex Twin",
      year: 1992,
      duration: 290,
      addedAt: 20,
      trackNo: 2,
    }),
  ];
}

function ids(tracks: Track[]): string[] {
  return tracks.map((track) => track.id);
}

test("query matches free text case- and diacritic-insensitively", () => {
  const library = new Library();
  library.replaceAll(sampleTracks());

  assert.deepEqual(ids(library.query({ text: "bjork" })), ["joga"]);
  assert.deepEqual(ids(library.query({ text: "JOGA" })), ["joga"]);
  assert.deepEqual(ids(library.query({ text: "homogenic" })), ["joga"]);
  assert.deepEqual(ids(library.query({ text: "aphex" })), ["windowlicker", "xtal"]);
  assert.deepEqual(ids(library.query({ text: "c:/music/xtal" })), ["xtal"]);
  assert.deepEqual(ids(library.query({ text: "no such thing" })), []);
});

test("query filters by artist and album", () => {
  const library = new Library();
  library.replaceAll(sampleTracks());

  assert.deepEqual(ids(library.query({ artist: "aphex twin" })), ["windowlicker", "xtal"]);
  assert.deepEqual(ids(library.query({ album: "Homogenic" })), ["joga"]);
  assert.deepEqual(ids(library.query({ album: "homogenic", artist: "bjork" })), ["joga"]);
  assert.deepEqual(ids(library.query({ album: "homogenic", artist: "aphex twin" })), []);
});

test("query sorts by the requested key and direction", () => {
  const library = new Library();
  library.replaceAll(sampleTracks());

  assert.deepEqual(ids(library.query({ sortBy: "title" })), ["joga", "windowlicker", "xtal"]);
  assert.deepEqual(ids(library.query({ sortBy: "title", sortDir: "desc" })), ["xtal", "windowlicker", "joga"]);
  assert.deepEqual(ids(library.query({ sortBy: "duration" })), ["xtal", "joga", "windowlicker"]);
  assert.deepEqual(ids(library.query({ sortBy: "year", sortDir: "desc" })), ["windowlicker", "joga", "xtal"]);
  assert.deepEqual(ids(library.query({ sortBy: "added" })), ["windowlicker", "xtal", "joga"]);
  assert.deepEqual(ids(library.query({ sortBy: "artist", sortDir: "desc" })), ["joga", "windowlicker", "xtal"]);
});

test("query paginates with limit and offset", () => {
  const library = new Library();
  library.replaceAll(sampleTracks());

  assert.deepEqual(ids(library.query({ sortBy: "title", limit: 2 })), ["joga", "windowlicker"]);
  assert.deepEqual(ids(library.query({ sortBy: "title", offset: 1 })), ["windowlicker", "xtal"]);
  assert.deepEqual(ids(library.query({ sortBy: "title", offset: 1, limit: 1 })), ["windowlicker"]);
  assert.deepEqual(ids(library.query({ sortBy: "title", offset: 99 })), []);
  assert.deepEqual(ids(library.query({ sortBy: "title", limit: 0 })), []);
});

test("upsert deduplicates by id and replaces the previous track", () => {
  const library = new Library();
  library.replaceAll([makeTrack("a"), makeTrack("b")]);

  library.upsert([makeTrack("b", { title: "B renamed" }), makeTrack("c")]);
  assert.equal(library.tracks.length, 3);
  assert.deepEqual(ids(library.tracks), ["a", "b", "c"]);
  assert.equal(library.tracks[1]?.title, "B renamed");

  library.upsert([makeTrack("a", { title: "A renamed" }), makeTrack("b", { title: "B renamed" }), makeTrack("c")]);
  assert.equal(library.tracks.length, 3);
  assert.equal(library.tracks[0]?.title, "A renamed");
});

test("remove and clear update the snapshot", () => {
  const library = new Library();
  library.replaceAll(sampleTracks(), 1234);
  assert.equal(library.snapshot.total, 3);
  assert.equal(library.snapshot.scannedAt, 1234);

  library.remove("joga");
  library.remove("unknown");
  assert.equal(library.snapshot.total, 2);

  library.clear();
  assert.equal(library.snapshot.total, 0);
  assert.equal(library.snapshot.tracks.length, 0);
  assert.equal(library.snapshot.scannedAt, null);
});

test("search is a shortcut for a free-text query", () => {
  const library = new Library();
  library.replaceAll(sampleTracks());
  assert.deepEqual(ids(library.search("ambient")), ["xtal"]);
});

test("albums groups tracks and sorts them by disc and track number", () => {
  const library = new Library();
  library.replaceAll(sampleTracks());
  library.upsert([
    makeTrack("xtal-bonus", {
      title: "Xtal (bonus)",
      artist: "Aphex Twin",
      album: "Selected Ambient Works",
      albumArtist: "Aphex Twin",
      year: 1992,
      trackNo: 1,
    }),
  ]);

  const albums = library.albums();
  assert.deepEqual(
    albums.map((album) => album.album),
    ["Homogenic", "Selected Ambient Works", "Windowlicker"],
  );

  const ambient = albums.find((album) => album.album === "Selected Ambient Works");
  assert.ok(ambient);
  assert.equal(ambient.albumArtist, "Aphex Twin");
  assert.equal(ambient.year, 1992);
  assert.deepEqual(ids(ambient.tracks), ["xtal-bonus", "xtal"]);

  const homogenic = albums.find((album) => album.album === "Homogenic");
  assert.equal(homogenic?.coverId, "cover-homogenic");
});

test("artists aggregates track and album counts", () => {
  const library = new Library();
  library.replaceAll(sampleTracks());

  const artists = library.artists();
  assert.deepEqual(
    artists.map((artist) => artist.artist),
    ["Aphex Twin", "Björk"],
  );
  assert.deepEqual(artists[0], { artist: "Aphex Twin", trackCount: 2, albums: 2 });
  assert.deepEqual(artists[1], { artist: "Björk", trackCount: 1, albums: 1 });
});

test("markPlayed increments the play count and stamps lastPlayedAt", () => {
  const library = new Library();
  library.replaceAll([makeTrack("a")]);

  library.markPlayed("a");
  library.markPlayed("a");
  library.markPlayed("unknown");

  assert.equal(library.tracks[0]?.playCount, 2);
  assert.equal(typeof library.tracks[0]?.lastPlayedAt, "number");
});

test("save/load round-trips through MemoryStore", async () => {
  const store = new MemoryStore();
  const library = new Library(store);
  library.replaceAll(sampleTracks(), 9876);
  await library.save();

  const restored = new Library(store);
  assert.equal(restored.snapshot.total, 0);
  await restored.load();

  assert.equal(restored.snapshot.total, 3);
  assert.equal(restored.snapshot.scannedAt, 9876);
  assert.deepEqual(ids(restored.tracks), ["joga", "windowlicker", "xtal"]);
  assert.equal(restored.tracks[0]?.title, "Jóga");

  // Persisted state is a copy: mutating the restored library must not change
  // the value still held by the store.
  restored.remove("joga");
  const reread = new Library(store);
  await reread.load();
  assert.equal(reread.snapshot.total, 3);
});

test("change events are debounced but flushed by save", async () => {
  const bus = new EventBus();
  const store = new MemoryStore();
  const library = new Library(store, bus);
  const changes: number[] = [];
  bus.on("library:change", (snapshot: { total: number }) => changes.push(snapshot.total));

  library.replaceAll(sampleTracks());
  assert.equal(changes.length, 0, "the change event is debounced");

  await library.save();
  assert.equal(changes.length, 1);
  assert.equal(changes[0], 3);

  // Another burst is coalesced into one event.
  library.upsert([makeTrack("extra")]);
  library.markPlayed("extra");
  await library.save();
  assert.equal(changes.length, 2);
  assert.equal(changes[1], 4);
});

test("MemoryStore returns fallbacks, copies values and flushes immediately", async () => {
  const store = new MemoryStore({ seed: { count: 1 } });
  assert.deepEqual(store.get("seed", null), { count: 1 });
  assert.equal(store.get("missing", 42), 42);

  const value = store.get<{ count: number }>("seed", { count: 0 });
  value.count = 99;
  assert.deepEqual(store.get("seed", null), { count: 1 });

  store.set("other", [1, 2, 3]);
  assert.deepEqual(store.get("other", []), [1, 2, 3]);
  store.delete("other");
  assert.equal(store.get("other", "gone"), "gone");
  await store.flush();
});
