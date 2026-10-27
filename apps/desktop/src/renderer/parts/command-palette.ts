/**
 * Command palette (Ctrl+K): fuzzy command + track search, fully keyboard driven.
 */

import { h, icon, on } from "../dom.js";
import { getState, visibleTracks, type AppState, type UiContext, type ViewPart } from "../state.js";
import type { Track } from "@fanduck/cadenza-core";

export interface PalettePart extends ViewPart {
  focus(): void;
}

interface PaletteEntry {
  id: string;
  label: string;
  sub: string;
  shortcut?: string;
  icon: "music" | "settings";
  run(): void;
}

/**
 * Cheap fuzzy score: a direct substring beats a subsequence match. Returns a
 * negative number when the query does not match at all.
 */
function fuzzyScore(query: string, text: string): number {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return 0;
  const haystack = text.toLowerCase();
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return 1000 - direct - haystack.length * 0.01;

  let position = 0;
  let score = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, position);
    if (found < 0) return -1;
    score += 100 - Math.min(90, found - position);
    position = found + 1;
  }
  return score;
}

export function createPalette(ctx: UiContext): PalettePart {
  const input = h("input", {
    class: "palette__input",
    type: "text",
    placeholder: "Search commands and tracks...",
    aria: { label: "Search commands and tracks", controls: "cz-palette-results", autocomplete: "list" },
    attrs: { spellcheck: "false", autocomplete: "off", role: "combobox", "aria-expanded": "true" },
  });

  const results = h("div", {
    class: "palette__results",
    id: "cz-palette-results",
    role: "listbox",
    attrs: { "aria-label": "Results" },
  });

  const empty = h("div", { class: "palette__empty", text: "No matches" });
  empty.hidden = true;

  const palette = h(
    "div",
    {
      class: "palette",
      role: "dialog",
      aria: { modal: "true", label: "Command palette" },
    },
    h("div", { class: "palette__search" }, icon("search", 19), input),
    results,
    empty,
    h(
      "div",
      { class: "palette__hint" },
      h("span", { text: "Up/Down navigate" }),
      h("span", { text: "Enter open" }),
      h("span", { text: "esc close" }),
    ),
  );

  const backdrop = h("div", { class: "palette-backdrop", on: { click: () => close() } });
  const layer = h("div", { class: "palette-layer" }, backdrop, palette);
  layer.hidden = true;

  let isOpen = false;
  let activeIndex = 0;
  let entries: PaletteEntry[] = [];
  let itemButtons: HTMLButtonElement[] = [];
  let previousFocus: HTMLElement | null = null;

  function open(): void {
    if (isOpen) {
      focus();
      return;
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    isOpen = true;
    layer.hidden = false;
    input.value = "";
    refresh();
    focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    layer.hidden = true;
    if (previousFocus?.isConnected) previousFocus.focus();
  }

  function focus(): void {
    input.focus();
    input.select();
  }

  /* -------------------------------------------------------------- results */

  function buildEntries(query: string): PaletteEntry[] {
    const state = getState();
    const commands = ctx.commands.map((command) => {
      const terms = [command.title, ...(command.keywords ?? [])].join(" ");
      return { command, score: fuzzyScore(query, terms) };
    });
    const commandEntries: PaletteEntry[] = commands
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(({ command }) => ({
        id: `command:${command.id}`,
        label: command.title,
        sub: "Command",
        icon: "settings",
        ...(command.shortcut !== undefined ? { shortcut: command.shortcut } : {}),
        run: () => {
          close();
          void Promise.resolve(command.run()).catch((error: unknown) => {
            console.error(`Cadenza: command ${command.id} failed`, error);
            ctx.actions.toast(`Command failed: ${command.title}`, "error");
          });
        },
      }));

    const tracks = query.trim().length === 0 ? visibleTracks(state).slice(0, 6) : state.tracks;
    const trackEntries: Array<{ track: Track; score: number }> = tracks
      .map((track) => ({
        track,
        score: query.trim().length === 0 ? 0 : fuzzyScore(query, `${track.title} ${track.artist} ${track.album}`),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const trackPaletteEntries: PaletteEntry[] = trackEntries.map(({ track }) => ({
      id: `track:${track.id}`,
      label: track.title,
      sub: `${track.artist} | ${track.album}`,
      icon: "music",
      run: () => {
        close();
        ctx.actions.playTracks([track]);
      },
    }));

    return [...commandEntries, ...trackPaletteEntries];
  }

  function refresh(): void {
    const query = input.value;
    entries = buildEntries(query);
    activeIndex = 0;
    renderResults(query);
  }

  function renderResults(query: string): void {
    results.replaceChildren();
    itemButtons = [];

    if (entries.length === 0) {
      empty.hidden = false;
      results.hidden = true;
      return;
    }
    empty.hidden = true;
    results.hidden = false;

    const commandCount = entries.filter((entry) => entry.icon === "settings").length;
    let lastGroup = "";

    entries.forEach((entry, index) => {
      const group = index < commandCount ? "Commands" : "Tracks";
      if (group !== lastGroup) {
        lastGroup = group;
        const title = group === "Tracks" && query.trim().length > 0 ? "Tracks" : group;
        results.append(h("div", { class: "palette__group-title", text: title }));
      }

      const button = h(
        "button",
        {
          class: "palette__item",
          type: "button",
          role: "option",
          id: `cz-palette-item-${index}`,
          aria: { selected: index === activeIndex ? "true" : "false" },
          on: {
            click: () => runEntry(index),
            pointermove: () => setActive(index, false),
          },
        },
        h("span", { class: "palette__item-icon" }, icon(entry.icon, 15)),
        h(
          "span",
          { class: "palette__item-text" },
          h("span", { class: "palette__label", text: entry.label }),
          h("span", { class: "palette__sub", text: entry.sub }),
        ),
        entry.shortcut ? h("span", { class: "kbd", text: entry.shortcut }) : null,
      );
      itemButtons.push(button);
      results.append(button);
    });

    input.setAttribute("aria-activedescendant", `cz-palette-item-${activeIndex}`);
  }

  function setActive(index: number, scroll = true): void {
    if (entries.length === 0) return;
    activeIndex = Math.max(0, Math.min(entries.length - 1, index));
    itemButtons.forEach((button, buttonIndex) => {
      button.setAttribute("aria-selected", buttonIndex === activeIndex ? "true" : "false");
    });
    input.setAttribute("aria-activedescendant", `cz-palette-item-${activeIndex}`);
    if (scroll) itemButtons[activeIndex]?.scrollIntoView({ block: "nearest" });
  }

  function runEntry(index: number): void {
    const entry = entries[index];
    if (!entry) return;
    entry.run();
  }

  /* --------------------------------------------------------------- events */

  input.addEventListener("input", () => refresh());

  input.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(entries.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        runEntry(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      default:
        break;
    }
  });

  // Keep focus inside the dialog.
  palette.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      focus();
    }
  });

  // Clicking outside closes.
  on(document, "pointerdown", (event) => {
    if (!isOpen) return;
    const target = event.target;
    if (target instanceof Node && palette.contains(target)) return;
    close();
  }, true);

  return {
    el: layer,
    focus,
    update(state: AppState): void {
      if (state.paletteOpen) open();
      else close();
      if (isOpen && document.activeElement !== input) {
        // State changed while open (e.g. queue update): refresh quietly.
        refresh();
      }
    },
    destroy(): void {
      close();
    },
  };
}
