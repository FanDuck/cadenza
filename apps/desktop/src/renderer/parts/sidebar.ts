/**
 * Sidebar: primary navigation + plugin slot + the collapse toggle.
 */

import { h, icon, setText, type IconName } from "../dom.js";
import { albumViews, artistViews, type AppState, type UiContext, type ViewId, type ViewPart } from "../state.js";

interface NavEntry {
  view: ViewId;
  label: string;
  icon: IconName;
  count: HTMLElement;
  button: HTMLButtonElement;
}

export function createSidebar(ctx: UiContext): ViewPart {
  const entries: NavEntry[] = [];

  const nav = h("nav", { class: "sidebar__nav", attrs: { "aria-label": "Library navigation" } });

  function addNav(view: ViewId, label: string, iconName: IconName): void {
    const count = h("span", { class: "nav-item__count", text: "0", aria: { hidden: true } });
    const button = h(
      "button",
      {
        class: "nav-item",
        type: "button",
        title: label,
        aria: { label, current: "false" },
        on: { click: () => ctx.actions.navigate(view) },
      },
      h("span", { class: "nav-item__icon" }, icon(iconName, 19)),
      h("span", { class: "nav-item__label", text: label }),
      count,
    );
    entries.push({ view, label, icon: iconName, count, button });
    nav.append(button);
  }

  addNav("library", "Library", "library");
  addNav("albums", "Albums", "albums");
  addNav("artists", "Artists", "artists");
  addNav("playlists", "Playlists", "playlists");

  const pluginFooter = h("div", { class: "sidebar__footer", dataset: { slot: "sidebar:footer" } });

  const pluginsButton = h(
    "button",
    {
      class: "nav-item",
      type: "button",
      title: "Plugins",
      aria: { label: "Plugins" },
      on: { click: () => ctx.actions.openSettings("plugins") },
    },
    h("span", { class: "nav-item__icon" }, icon("plugins", 19)),
    h("span", { class: "nav-item__label", text: "Plugins" }),
  );

  const settingsButton = h(
    "button",
    {
      class: "nav-item",
      type: "button",
      title: "Settings",
      aria: { label: "Settings" },
      on: { click: () => ctx.actions.navigate("settings") },
    },
    h("span", { class: "nav-item__icon" }, icon("settings", 19)),
    h("span", { class: "nav-item__label", text: "Settings" }),
  );

  const collapseButton = h(
    "button",
    {
      class: "sidebar__collapse",
      type: "button",
      title: "Collapse sidebar",
      aria: { label: "Collapse sidebar", expanded: "true", controls: "cz-sidebar" },
      on: { click: () => ctx.actions.toggleSidebar() },
    },
    h("span", { class: "nav-item__icon" }, icon("chevron-left", 18)),
    h("span", { class: "nav-item__label", text: "Collapse" }),
  );

  const bottom = h("div", { class: "sidebar__bottom" }, pluginsButton, settingsButton, pluginFooter, collapseButton);

  const el = h(
    "aside",
    { class: "sidebar", id: "cz-sidebar", attrs: { "aria-label": "Sidebar" } },
    nav,
    h("div", { class: "sidebar__spacer" }),
    bottom,
  );

  function update(state: AppState): void {
    const albums = albumViews(state.tracks);
    const artists = artistViews(state.tracks);
    const counts: Record<ViewId, number> = {
      library: state.libraryTotal || state.tracks.length,
      albums: albums.length,
      artists: artists.length,
      playlists: state.playlists.length,
      settings: 0,
      "now-playing": 0,
    };

    for (const entry of entries) {
      const current = state.view === entry.view;
      entry.button.setAttribute("aria-current", current ? "page" : "false");
      setText(entry.count, String(counts[entry.view] ?? 0));
      entry.count.hidden = (counts[entry.view] ?? 0) === 0;
    }

    const settingsActive = state.view === "settings";
    settingsButton.setAttribute("aria-current", settingsActive ? "page" : "false");

    const collapsed = state.sidebarCollapsed;
    collapseButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
    collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    collapseButton.title = collapsed ? "Expand sidebar" : "Collapse sidebar";

    // When collapsed the visible label is hidden; keep the accessible name right.
    nav.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
      const label = button.title;
      if (label) button.setAttribute("aria-label", label);
    });
  }

  return { el, update };
}
