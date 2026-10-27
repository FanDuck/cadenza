/**
 * Player bar.
 *
 * Hosts `<cz-now-playing>` from the UI kit, forwards its events to the player,
 * keeps the window title and taskbar in sync, and - in the browser demo only -
 * runs the 250ms ticker that pretends the silent audio sink is playing.
 */

import { h } from "../dom.js";
import { resolveCover, type UiContext, type ViewPart } from "../state.js";
import type { PlayerSnapshot } from "@fanduck/cadenza-core";

/** The subset of `<cz-now-playing>` this app talks to. */
interface NowPlayingElement extends HTMLElement {
  snapshot: PlayerSnapshot | null;
  coverUrl: string | null;
}

interface SeekDetail {
  seconds: number;
}
interface VolumeDetail {
  volume: number;
}
interface ShuffleDetail {
  shuffle: boolean;
}
interface RepeatDetail {
  repeat: PlayerSnapshot["repeat"];
}

export function createPlayerBar(ctx: UiContext): ViewPart {
  const nowPlaying = document.createElement("cz-now-playing") as unknown as NowPlayingElement;
  nowPlaying.id = "cz-now-playing";
  nowPlaying.title = "Double-click to open the Now playing view";
  nowPlaying.addEventListener("dblclick", (event) => {
    // Ignore double-clicks that land on the component's own controls.
    if (event.composedPath()[0] !== nowPlaying) return;
    ctx.actions.navigate("now-playing");
  });

  const el = h("footer", { class: "player-bar", attrs: { "aria-label": "Player" } }, nowPlaying);

  let lastSnapshot: PlayerSnapshot | null = null;
  let lastCoverTrackId: string | null = null;
  let coverRequest = 0;
  let lastReport = 0;
  let demoTicker: number | null = null;

  /* ------------------------------------------------------------- audio graph */

  // The WebAudio analyser can only be created from a user gesture; every control
  // in this bar is one.
  const withAudio = (): void => {
    ctx.actions.ensureAudio();
  };

  /* ------------------------------------------------------------- demo clock */

  function stopDemoTicker(): void {
    if (demoTicker !== null) {
      window.clearInterval(demoTicker);
      demoTicker = null;
    }
  }

  function startDemoTicker(): void {
    if (demoTicker !== null) return;
    demoTicker = window.setInterval(tickDemo, 250);
  }

  /**
   * Demo only: `HtmlAudioSink` runs in silent mode (resolveUrl returns ""), so
   * nothing advances the clock. Move the synthetic position ourselves and let
   * the Player's normal `next()` handling move on at the end of a track.
   */
  function tickDemo(): void {
    const snapshot = ctx.player.snapshot;
    if (snapshot.state !== "playing") {
      stopDemoTicker();
      return;
    }
    const duration = snapshot.duration > 0 ? snapshot.duration : (snapshot.track?.duration ?? 0);
    const next = snapshot.position + 0.25;
    if (duration > 0 && next >= duration - 0.05) {
      ctx.player.next();
      return;
    }
    ctx.player.seek(next);
  }

  function syncDemoTicker(snapshot: PlayerSnapshot | null): void {
    if (!ctx.bridge.demo) return;
    if (snapshot?.state === "playing") startDemoTicker();
    else stopDemoTicker();
  }

  /* -------------------------------------------------------------- snapshots */

  function applySnapshot(snapshot: PlayerSnapshot): void {
    lastSnapshot = snapshot;
    nowPlaying.snapshot = snapshot;

    const track = snapshot.track;
    if (track?.id !== lastCoverTrackId) {
      lastCoverTrackId = track?.id ?? null;
      coverRequest += 1;
      const request = coverRequest;
      nowPlaying.coverUrl = null;
      if (track) {
        void resolveCover(ctx.bridge, track.coverId).then((url) => {
          if (request === coverRequest && lastSnapshot?.track?.id === track.id) nowPlaying.coverUrl = url;
        });
      }
    }

    if (track) document.title = `${track.title} | ${track.artist} - Cadenza`;
    else document.title = "Cadenza";

    // Taskbar (Windows) / dock (macOS) integration: once per second is plenty.
    const now = Date.now();
    if (now - lastReport >= 1000) {
      lastReport = now;
      try {
        ctx.bridge.player.report(snapshot);
      } catch (error) {
        console.warn("Cadenza: player.report failed", error);
      }
    }

    syncDemoTicker(snapshot);
  }

  /* --------------------------------------------------------------- controls */

  nowPlaying.addEventListener("cz-toggle", ((event: Event) => {
    event.stopPropagation();
    withAudio();
    ctx.player.toggle();
  }) as EventListener);

  nowPlaying.addEventListener("cz-next", (() => ctx.player.next()) as EventListener);
  nowPlaying.addEventListener("cz-prev", (() => ctx.player.previous()) as EventListener);

  nowPlaying.addEventListener("cz-seek", ((event: Event) => {
    const detail = detailOf<SeekDetail>(event);
    if (!detail) return;
    withAudio();
    ctx.player.seek(detail.seconds);
  }) as EventListener);

  nowPlaying.addEventListener("cz-volume", ((event: Event) => {
    const detail = detailOf<VolumeDetail>(event);
    if (!detail) return;
    withAudio();
    ctx.player.setVolume(detail.volume);
    if (ctx.player.snapshot.muted) ctx.player.setMuted(false);
  }) as EventListener);

  nowPlaying.addEventListener("cz-mute", (() => {
    ctx.player.setMuted(!ctx.player.snapshot.muted);
  }) as EventListener);

  nowPlaying.addEventListener("cz-shuffle", ((event: Event) => {
    const detail = detailOf<ShuffleDetail>(event);
    if (!detail) return;
    ctx.player.setShuffle(detail.shuffle);
  }) as EventListener);

  nowPlaying.addEventListener("cz-repeat", ((event: Event) => {
    const detail = detailOf<RepeatDetail>(event);
    if (!detail) return;
    ctx.player.setRepeat(detail.repeat);
  }) as EventListener);

  nowPlaying.addEventListener("cz-toggle-queue", (() => ctx.actions.toggleQueue()) as EventListener);

  nowPlaying.addEventListener("cz-like", (() => {
    // The reference player has no favourites store yet; be honest about it.
    ctx.actions.toast("Favourites are not part of the reference player yet", "info");
  }) as EventListener);

  const unsubscribe = ctx.player.onSnapshot(applySnapshot);

  return {
    el,
    update(): void {
      // The bar is driven by player snapshots, not by app state.
    },
    destroy(): void {
      unsubscribe();
      stopDemoTicker();
    },
  };
}

function detailOf<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent)) return null;
  return (event.detail as T | null) ?? null;
}
