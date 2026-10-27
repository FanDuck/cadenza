/**
 * The fictional library used by the browser demo.
 *
 * `npm run demo` must be interesting without shipping copyrighted audio, so the
 * demo bridge invents four albums (18 tracks) and paints their covers as
 * generated SVG gradients. No `file://` paths and no real media: `mediaUrl()`
 * returns "" and the player bar simulates playback.
 *
 * Everything here is deterministic: the same seed always produces the same
 * gradient, so screenshots and tests are stable.
 */

import type { Track } from "@fanduck/cadenza-core";

/** Where the fake files "live" on disk. */
export const DEMO_MUSIC_ROOT = "C:\\Users\\Demo\\Music";

interface DemoTrackSeed {
  trackNo: number;
  title: string;
  /** Duration in seconds. */
  seconds: number;
  /** Optional: already played in the fake history. */
  playCount?: number;
}

interface DemoAlbumSeed {
  album: string;
  artist: string;
  genre: string;
  year: number;
  coverId: string;
  /** Epoch millis; tracks of the same album are added a minute apart. */
  addedAt: number;
  /** Two-stop gradient used by the generated cover art. */
  palette: readonly [string, string];
  codec: string;
  extension: string;
  bitrate: number;
  tracks: readonly DemoTrackSeed[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Four albums, 18 tracks, durations between 2:38 and 5:19. */
const ALBUMS: readonly DemoAlbumSeed[] = [
  {
    album: "Neon Tide",
    artist: "Mira Vale",
    genre: "Synthpop",
    year: 2023,
    coverId: "demo-cover-neon-tide",
    addedAt: Date.UTC(2024, 0, 5),
    palette: ["#12203f", "#f25f9c"],
    codec: "FLAC",
    extension: "flac",
    bitrate: 1044000,
    tracks: [
      { trackNo: 1, title: "Glass Harbour", seconds: 222, playCount: 14 },
      { trackNo: 2, title: "Neon Tide", seconds: 245, playCount: 31 },
      { trackNo: 3, title: "Slow Orbit", seconds: 198, playCount: 8 },
      { trackNo: 4, title: "Afterglow Arcade", seconds: 176 },
      { trackNo: 5, title: "Salt & Static", seconds: 272, playCount: 3 },
    ],
  },
  {
    album: "Paper Lanterns",
    artist: "The Quiet Hours",
    genre: "Indie Folk",
    year: 2021,
    coverId: "demo-cover-paper-lanterns",
    addedAt: Date.UTC(2024, 1, 11),
    palette: ["#3a2418", "#f2b45c"],
    codec: "MP3",
    extension: "mp3",
    bitrate: 320000,
    tracks: [
      { trackNo: 1, title: "Lanterns in the Rain", seconds: 207, playCount: 22 },
      { trackNo: 2, title: "Hollow Pines", seconds: 252, playCount: 5 },
      { trackNo: 3, title: "Kettle & Thread", seconds: 164 },
      { trackNo: 4, title: "Northbound Hymn", seconds: 303, playCount: 11 },
    ],
  },
  {
    album: "Midnight Transit",
    artist: "Kaito Mori",
    genre: "Ambient Techno",
    year: 2024,
    coverId: "demo-cover-midnight-transit",
    addedAt: Date.UTC(2024, 2, 20),
    palette: ["#07131f", "#3fb6c9"],
    codec: "FLAC",
    extension: "flac",
    bitrate: 951000,
    tracks: [
      { trackNo: 1, title: "Platform Zero", seconds: 288, playCount: 19 },
      { trackNo: 2, title: "Night Bus, 03:14", seconds: 194, playCount: 7 },
      { trackNo: 3, title: "Interchange", seconds: 261 },
      { trackNo: 4, title: "Neon Underpass", seconds: 319, playCount: 2 },
      { trackNo: 5, title: "Last Train Home", seconds: 235, playCount: 26 },
    ],
  },
  {
    album: "Aurora Field",
    artist: "Elsa Nord",
    genre: "Dream Pop",
    year: 2022,
    coverId: "demo-cover-aurora-field",
    addedAt: Date.UTC(2024, 3, 2),
    palette: ["#0d2033", "#8be0c8"],
    codec: "AAC",
    extension: "m4a",
    bitrate: 256000,
    tracks: [
      { trackNo: 1, title: "Polar Light", seconds: 216, playCount: 17 },
      { trackNo: 2, title: "Snowblind", seconds: 247, playCount: 4 },
      { trackNo: 3, title: "Aurora Field", seconds: 296, playCount: 9 },
      { trackNo: 4, title: "Quiet Comet", seconds: 158 },
    ],
  },
];

/** Lowercase, dash-separated slug used in ids and file names. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function fileNameFor(seed: DemoTrackSeed, album: DemoAlbumSeed): string {
  const no = String(seed.trackNo).padStart(2, "0");
  const safeTitle = seed.title.replace(/[\\/:*?"<>|]/gu, "-");
  return `${no} - ${safeTitle}.${album.extension}`;
}

function buildTracks(): Track[] {
  const tracks: Track[] = [];
  for (const album of ALBUMS) {
    for (const seed of album.tracks) {
      const fileName = fileNameFor(seed, album);
      tracks.push({
        id: `demo:${slug(album.artist)}:${slug(album.album)}:${seed.trackNo}`,
        path: `${DEMO_MUSIC_ROOT}\\${album.album}\\${fileName}`,
        title: seed.title,
        artist: album.artist,
        album: album.album,
        albumArtist: album.artist,
        genre: album.genre,
        year: album.year,
        trackNo: seed.trackNo,
        discNo: 1,
        duration: seed.seconds,
        bitrate: album.bitrate,
        sampleRate: 44100,
        channels: 2,
        codec: album.codec,
        // ~bitrate/8 bytes per second, close enough for the UI's file-size label.
        size: Math.round((seed.seconds * album.bitrate) / 8),
        coverId: album.coverId,
        addedAt: album.addedAt + seed.trackNo * 60_000,
        ...(seed.playCount !== undefined ? { playCount: seed.playCount } : {}),
        ...(seed.playCount !== undefined ? { lastPlayedAt: Date.now() - seed.trackNo * DAY } : {}),
        origin: "scan",
      });
    }
  }
  return tracks;
}

/** The demo library. Treat as read-only; the demo bridge hands out copies. */
export const SAMPLE_TRACKS: readonly Track[] = buildTracks();

export interface SampleAlbum {
  album: string;
  artist: string;
  coverId: string;
  palette: readonly [string, string];
  initials: string;
}

/** Album metadata used by the cover generator. */
export const SAMPLE_ALBUMS: readonly SampleAlbum[] = ALBUMS.map((album) => ({
  album: album.album,
  artist: album.artist,
  coverId: album.coverId,
  palette: album.palette,
  initials: album.album
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2),
}));

/* ------------------------------------------------------------ cover art */

const COVER_ALBUM = new Map<string, SampleAlbum>(SAMPLE_ALBUMS.map((album) => [album.coverId, album]));

/**
 * Generate deterministic SVG cover art for a demo `coverId`.
 *
 * The album name is static demo data (never user input) and is only used as an
 * SVG `<text>` node, so there is no markup-injection surface here.
 */
export function coverDataUrl(coverId: string): string | null {
  const album = COVER_ALBUM.get(coverId);
  if (!album) return null;
  const [from, to] = album.palette;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" role="img" aria-label="${escapeXml(album.album)} cover">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.22" cy="0.16" r="0.95">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="300" height="300" fill="url(#bg)"/>
  <circle cx="238" cy="64" r="128" fill="#ffffff" opacity="0.10"/>
  <circle cx="52" cy="268" r="108" fill="#000000" opacity="0.16"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.5">
    <circle cx="238" cy="64" r="94"/>
    <circle cx="238" cy="64" r="60"/>
    <circle cx="238" cy="64" r="26"/>
  </g>
  <rect width="300" height="300" fill="url(#glow)"/>
  <g fill="#ffffff">
    <text x="26" y="52" font-family="Segoe UI, system-ui, sans-serif" font-size="13" letter-spacing="5" opacity="0.72">CADENZA DEMO</text>
    <text x="24" y="226" font-family="Segoe UI, system-ui, sans-serif" font-size="88" font-weight="700" opacity="0.92">${escapeXml(album.initials)}</text>
    <text x="27" y="258" font-family="Segoe UI, system-ui, sans-serif" font-size="18" opacity="0.92">${escapeXml(album.album)}</text>
    <text x="27" y="280" font-family="Segoe UI, system-ui, sans-serif" font-size="13" opacity="0.66">${escapeXml(album.artist)}</text>
  </g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/gu, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/* ---------------------------------------------------------------- lyrics */

/**
 * Hand-written LRC for the first three demo tracks. The demo bridge returns
 * these so the Now playing view has something to show; everything else falls
 * back to the empty state.
 */
const SAMPLE_LRC = new Map<string, string>([
  [
    SAMPLE_TRACKS[0]?.path ?? "",
    `[ti:Glass Harbour]
[ar:Mira Vale]
[al:Neon Tide]
[00:08.00]Harbour lights are folding into glass
[00:17.50]Every window keeps a little of the past
[00:27.00]I count the ferries till the morning comes
[00:37.20]A quiet city hums in neon tones
[00:47.00]And if the tide turns, let it turn for us
[00:57.40]We are only passing through the dark
[01:08.00]Glass harbour, hold the night a little longer
[01:19.60]Glass harbour, keep the water calm
[01:31.00]Every wave a rerun of a song we knew
[01:42.00]Every light a promise we forgot
[01:54.00]Glass harbour, hold the night a little longer
[02:08.00]We'll be gone before the morning does`,
  ],
  [
    SAMPLE_TRACKS[5]?.path ?? "",
    `[ti:Neon Tide]
[ar:Mira Vale]
[al:Neon Tide]
[00:06.50]Wake up in the glow of a borrowed sun
[00:16.00]Static on the radio, the night is young
[00:26.40]Paint the skyline over everything we lost
[00:37.00]The neon tide is rising, let it wash across
[00:48.00]Hold on, hold on, the water's warm
[00:58.50]Hold on, hold on, until the dawn
[01:09.00]Neon tide, carry me over
[01:20.00]Neon tide, under the city
[01:32.00]Every colour bleeding into one long line
[01:43.00]Every heartbeat syncing with the sign
[01:55.00]Neon tide, carry me over
[02:07.00]Neon tide, carry me home`,
  ],
  [
    SAMPLE_TRACKS[2]?.path ?? "",
    `[ti:Slow Orbit]
[ar:Mira Vale]
[al:Neon Tide]
[00:10.00]We move in circles, never touching ground
[00:21.00]Gravity is gentle when you're not around
[00:32.00]A slow orbit, a steady light
[00:43.00]Turning softly through the night
[00:54.00]If I fall, I fall in time with you
[01:05.00]If I stay, I stay for the view
[01:17.00]Slow orbit, keep me in your sky
[01:29.00]Slow orbit, I don't need to fly
[01:42.00]Every sunrise is a little less bright
[01:54.00]Every satellite is looking for a light
[02:06.00]Slow orbit, keep me in your sky
[02:18.00]Slow orbit, I don't need to fly`,
  ],
]);

/** Generated LRC for the first three demo tracks, else `null`. */
export function sampleLrc(trackPath: string): string | null {
  return SAMPLE_LRC.get(trackPath) ?? null;
}

/** Cover ids that exist, used by the demo bridge (`library.cover`). */
export function sampleCoverIds(): string[] {
  return SAMPLE_ALBUMS.map((album) => album.coverId);
}
