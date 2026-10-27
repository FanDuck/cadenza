/**
 * Queue panel: the play queue as a compact track list, with a Clear button.
 */

import { h, setText } from "../dom.js";
import type { QueueState, Track } from "@fanduck/cadenza-core";
import type { TrackListElement, UiContext, ViewPart } from "../state.js";

interface TrackActivateDetail {
  track: Track;
  index: number;
}

interface TrackMenuDetail {
  track: Track;
  index: number;
  x: number;
  y: number;
}

interface ReorderDetail {
  from: number | { index: number };
  to: number | { index: number };
}

export function createQueuePanel(ctx: UiContext): ViewPart {
  const fill = document.createElement("cz-track-list") as unknown as TrackListElement;
  fill.variant = "compact";
  fill.emptyText = "The queue is empty. Play an album or a playlist to fill it.";
  fill.showHeader = false;
  fill.tracks = [];
  fill.currentId = null;
  fill.playing = false;

  const count = h("span", { class: "queue-panel__count", text: "0 tracks" });
  const clearButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Clear the play queue" },
      on: { click: () => ctx.player.clearQueue() },
    },
    h("span", { text: "Clear" }),
  );

  const head = h(
    "div",
    { class: "queue-panel__head" },
    h("h2", { class: "queue-panel__title", text: "Queue" }),
    count,
    clearButton,
  );

  const body = h("div", { class: "queue-panel__body" }, fill);

  const footerText = h("span", { text: "Up next" });
  const footer = h("div", { class: "queue-panel__footer" }, footerText);

  const el = h(
    "aside",
    {
      class: "queue-panel",
      id: "cz-queue-panel",
      attrs: { "aria-label": "Play queue" },
    },
    head,
    body,
    footer,
  );

  fill.addEventListener("cz-activate", ((event: Event) => {
    const detail = detailOf<TrackActivateDetail>(event);
    if (!detail) return;
    ctx.actions.playTracks(ctx.player.queue.items, detail.index);
  }) as EventListener);

  fill.addEventListener("cz-menu", ((event: Event) => {
    const detail = detailOf<TrackMenuDetail>(event);
    if (!detail) return;
    ctx.actions.showTrackMenu(detail.track, detail.x, detail.y);
  }) as EventListener);

  fill.addEventListener("cz-reorder", ((event: Event) => {
    const detail = detailOf<ReorderDetail>(event);
    if (!detail) return;
    // The kit emits `{ from, to }`; tolerate a nested `{ index }` shape too.
    const from = typeof detail.from === "number" ? detail.from : detail.from.index;
    const to = typeof detail.to === "number" ? detail.to : detail.to.index;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;

    const queue = ctx.player.queue;
    const currentId = queue.items[queue.index]?.id ?? null;
    const next = [...queue.items];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);

    // Keep playing the same track after the reorder.
    const currentIndex = currentId ? next.findIndex((track) => track.id === currentId) : queue.index;
    ctx.player.setQueue(next, currentIndex >= 0 ? currentIndex : Math.min(queue.index, next.length - 1));
  }) as EventListener);

  /* ------------------------------------------------------------- reactions */

  function renderQueue(queue: QueueState): void {
    fill.tracks = [...queue.items];
    setText(count, queue.items.length === 1 ? "1 track" : `${queue.items.length} tracks`);
    clearButton.disabled = queue.items.length === 0;
    footerText.textContent =
      queue.items.length === 0 ? "Nothing queued" : "Drag to reorder | right-click for options";
  }

  const unsubscribeQueue = ctx.player.onQueueChange(renderQueue);
  const unsubscribeSnapshot = ctx.player.onSnapshot((snapshot) => {
    fill.currentId = snapshot.track?.id ?? null;
    fill.playing = snapshot.state === "playing";
  });

  renderQueue(ctx.player.queue);

  return {
    el,
    update(state): void {
      const open = state.queueOpen;
      el.toggleAttribute("inert", !open);
      el.setAttribute("aria-hidden", open ? "false" : "true");
    },
    destroy(): void {
      unsubscribeQueue();
      unsubscribeSnapshot();
    },
  };
}

function detailOf<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent)) return null;
  return (event.detail as T | null) ?? null;
}
