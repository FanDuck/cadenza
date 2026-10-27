/**
 * Settings view: library folders, appearance, playback, plugins and about.
 *
 * Every control writes through `ctx.settings.update()` (the one place that
 * persists settings) and re-renders from app state, so the view has no local
 * copy of the settings to keep in sync.
 */

import { h, icon, setText } from "../dom.js";
import {
  ACCENTS,
  THEMES,
  type Theme,
} from "../themes.js";
import {
  getState,
  setState,
  type AppState,
  type SettingsSection,
  type UiContext,
  type ViewPart,
} from "../state.js";
import type { AppSettings, PluginInfo } from "@fanduck/cadenza-core";

const REPO_URL = "https://github.com/FanDuck/cadenza";
const ISSUES_URL = "https://github.com/FanDuck/cadenza/issues";
const LICENSE_URL = "https://github.com/FanDuck/cadenza/blob/main/LICENSE";

export function createSettingsView(ctx: UiContext): ViewPart {
  const el = h("div", { class: "settings" });

  /* --------------------------------------------------------------- library */

  const folders = h("div", { class: "folder-list" });
  const libraryEmpty = h("p", { class: "settings-empty", text: "No music folders yet. Add one and Cadenza will scan it." });

  const addFolderButton = h(
    "button",
    {
      class: "primary-btn",
      type: "button",
      aria: { label: "Add a music folder" },
      on: { click: () => void ctx.actions.addMusicFolder() },
    },
    icon("folder", 15),
    h("span", { text: "Add folder" }),
  );

  const rescanButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Rescan all music folders" },
      on: { click: () => void ctx.actions.rescan() },
    },
    icon("refresh", 15),
    h("span", { text: "Rescan" }),
  );

  const libraryHint = h("p", { class: "settings-row__desc", text: "Cadenza only reads files locally." });

  const librarySection = section(
    "library",
    "Music library",
    h(
      "div",
      { class: "settings-card" },
      h("div", { class: "settings-row" }, h("div", { class: "settings-row__text" }, h("p", { class: "settings-row__title", text: "Music folders" }), libraryHint), h("div", { class: "settings-actions" }, rescanButton, addFolderButton)),
      folders,
      libraryEmpty,
    ),
  );

  /* ----------------------------------------------------------- appearance */

  const themeGrid = h("div", { class: "theme-grid" });
  const swatches = h("div", { class: "swatches" });

  const appearanceSection = section(
    "appearance",
    "Appearance",
    h(
      "div",
      { class: "settings-card" },
      h(
        "div",
        { class: "settings-row" },
        h(
          "div",
          { class: "settings-row__text" },
          h("p", { class: "settings-row__title", text: "Theme" }),
          h("p", { class: "settings-row__desc", text: "Midnight, Daylight and Synthwave are built in. Plugins can add more." }),
        ),
      ),
      themeGrid,
      h(
        "div",
        { class: "settings-row" },
        h(
          "div",
          { class: "settings-row__text" },
          h("p", { class: "settings-row__title", text: "Accent" }),
          h("p", { class: "settings-row__desc", text: "Used for the app mark, active navigation and highlights." }),
        ),
      ),
      swatches,
    ),
  );

  /* ------------------------------------------------------------- playback */

  const resumeToggle = toggleSwitch("Resume the last session on startup", "resumeSession");
  const mediaKeysToggle = toggleSwitch("Handle keyboard media keys", "mediaKeys");

  const playbackSection = section(
    "playback",
    "Playback",
    h(
      "div",
      { class: "settings-card" },
      h(
        "div",
        { class: "settings-row" },
        h(
          "div",
          { class: "settings-row__text" },
          h("p", { class: "settings-row__title", text: "Resume session" }),
          h("p", { class: "settings-row__desc", text: "Restore the queue and the current track when Cadenza starts." }),
        ),
        resumeToggle.el,
      ),
      h(
        "div",
        { class: "settings-row" },
        h(
          "div",
          { class: "settings-row__text" },
          h("p", { class: "settings-row__title", text: "Media keys" }),
          h("p", { class: "settings-row__desc", text: "Play, pause and skip from the keyboard or the Windows media overlay." }),
        ),
        mediaKeysToggle.el,
      ),
    ),
  );

  /* -------------------------------------------------------------- plugins */

  const pluginList = h("div", { class: "settings-card" });
  const pluginEmpty = h("p", {
    class: "settings-empty",
    text: "No plugins installed yet. Drop a plugin folder into the plugin directory and press Reload.",
  });

  const openPluginsButton = h(
    "button",
    {
      class: "ghost-btn",
      type: "button",
      aria: { label: "Open the plugin folder" },
      on: {
        click: () => {
          void ctx.plugins.openFolder().catch((error: unknown) => {
            console.error("Cadenza: could not open the plugin folder", error);
            ctx.actions.toast("Could not open the plugin folder", "error");
          });
        },
      },
    },
    icon("folder", 15),
    h("span", { text: "Open plugin folder" }),
  );

  const reloadPluginsButton = h(
    "button",
    {
      class: "primary-btn",
      type: "button",
      aria: { label: "Reload installed plugins" },
      on: {
        click: () => {
          void reloadPlugins();
        },
      },
    },
    icon("refresh", 15),
    h("span", { text: "Reload" }),
  );

  const pluginActions = h("div", { class: "settings-row" }, h("div", { class: "view-actions__spacer" }), h("div", { class: "settings-actions" }, openPluginsButton, reloadPluginsButton));

  const pluginSlot = h("div", { dataset: { slot: "settings:section" } });

  const pluginsSection = section(
    "plugins",
    "Plugins",
    pluginList,
    pluginEmpty,
    pluginActions,
    pluginSlot,
  );

  /* ---------------------------------------------------------------- about */

  const versionLine = h("p", { class: "about__line", text: "" });
  const runtimeLine = h("p", { class: "about__line", text: "" });

  const links = [
    { label: "Repository", url: REPO_URL },
    { label: "Issues", url: ISSUES_URL },
    { label: "License (MIT)", url: LICENSE_URL },
  ].map((link) =>
    h(
      "button",
      {
        class: "ghost-btn",
        type: "button",
        aria: { label: `Open ${link.label}` },
        on: {
          click: () => {
            void ctx.bridge.shell.openExternal(link.url).catch((error: unknown) => {
              console.error("Cadenza: could not open link", error);
              ctx.actions.toast("Could not open the link", "error");
            });
          },
        },
      },
      icon("external", 14),
      h("span", { text: link.label }),
    ),
  );

  const aboutSection = section(
    "about",
    "About",
    h(
      "div",
      { class: "settings-card" },
      h(
        "div",
        { class: "about" },
        h("p", { class: "about__name", text: "Cadenza" }),
        h("p", { class: "settings-row__desc", text: "A plugin-first music player framework for Windows. Built with TypeScript and native ES modules - no bundler." }),
        versionLine,
        runtimeLine,
        h("div", { class: "link-row" }, ...links),
        h("p", { class: "settings-row__desc", text: "Cadenza is open source under the MIT license. Your music stays on your machine." }),
      ),
    ),
  );

  el.append(librarySection, appearanceSection, playbackSection, pluginsSection, aboutSection);

  /* --------------------------------------------------------------- actions */

  async function patch(patch: Partial<AppSettings>): Promise<void> {
    try {
      await ctx.settings.update(patch);
    } catch (error) {
      console.error("Cadenza: could not save settings", error);
      ctx.actions.toast("Could not save that setting", "error");
    }
  }

  function toggleSwitch(label: string, key: "resumeSession" | "mediaKeys"): { el: HTMLElement; input: HTMLInputElement } {
    const input = h("input", {
      type: "checkbox",
      aria: { label },
      on: {
        change: () => {
          void patch(key === "resumeSession" ? { resumeSession: input.checked } : { mediaKeys: input.checked });
        },
      },
    });
    const wrapper = h("label", { class: "toggle", title: label }, input, h("span", { class: "toggle__track" }));
    wrapper.dataset.settingKey = key;
    return { el: wrapper, input };
  }

  async function reloadPlugins(): Promise<void> {
    reloadPluginsButton.disabled = true;
    try {
      const plugins = await ctx.plugins.reload();
      setState({ plugins });
      ctx.actions.toast(`Reloaded ${plugins.length} ${plugins.length === 1 ? "plugin" : "plugins"}`, "success");
      update(getState());
    } catch (error) {
      console.error("Cadenza: plugin reload failed", error);
      ctx.actions.toast("Plugin reload failed", "error");
    } finally {
      reloadPluginsButton.disabled = false;
    }
  }

  /* -------------------------------------------------------------- rendering */

  function renderFolders(state: AppState): void {
    const roots = state.settings.libraryRoots;
    folders.replaceChildren(
      ...roots.map((root) =>
        h(
          "div",
          { class: "folder-chip" },
          icon("folder", 15),
          h("span", { class: "folder-chip__path", text: root, title: root }),
          h(
            "button",
            {
              class: "folder-chip__remove",
              type: "button",
              aria: { label: `Remove ${root} from the library` },
              on: {
                click: () => {
                  const next = roots.filter((entry) => entry !== root);
                  void patch({ libraryRoots: next }).then(() => {
                    ctx.actions.toast("Folder removed. Rescan to refresh the library.", "info");
                  });
                },
              },
            },
            icon("close", 13),
          ),
        ),
      ),
    );
    folders.hidden = roots.length === 0;
    libraryEmpty.hidden = roots.length > 0;
    rescanButton.disabled = roots.length === 0 || state.scan !== null;
    addFolderButton.disabled = state.scan !== null;

    const scanned = state.scannedAt;
    libraryHint.textContent =
      scanned === null
        ? "Cadenza only reads files locally."
        : `Last scan ${new Date(scanned).toLocaleString()} | ${state.libraryTotal} tracks in the library.`;
  }

  function renderThemes(state: AppState): void {
    themeGrid.replaceChildren(
      ...THEMES.map((theme) => {
        const active = state.settings.theme === theme.id;
        return h(
          "button",
          {
            class: "theme-card",
            type: "button",
            aria: { pressed: active ? "true" : "false", label: `Use the ${theme.name} theme` },
            on: {
              click: () => {
                void ctx.actions.applyTheme(theme.id, state.settings.accent);
              },
            },
          },
          themePreview(theme),
          h("span", { class: "theme-card__name", text: theme.name }),
          h("p", { class: "theme-card__desc", text: theme.description }),
        );
      }),
    );

    swatches.replaceChildren(
      ...ACCENTS.map((accent) => {
        const active = state.settings.accent === accent.id;
        return h(
          "button",
          {
            class: "swatch",
            type: "button",
            aria: { pressed: active ? "true" : "false", label: `${accent.name} accent` },
            title: accent.name,
            on: {
              click: () => {
                void ctx.actions.applyTheme(state.settings.theme, accent.id);
              },
            },
          },
          h("span", {
            class: "swatch__dot",
            style: `background: linear-gradient(135deg, ${accent.color}, ${accent.color2})`,
          }),
        );
      }),
    );
  }

  function themePreview(theme: Theme): HTMLElement {
    const vars = theme.vars;
    return h(
      "span",
      { class: "theme-card__preview", attrs: { "aria-hidden": "true" } },
      h("span", { style: `background:${vars["--cz-bg"] ?? "transparent"}` }),
      h("span", { style: `background:${vars["--cz-surface"] ?? "transparent"}` }),
      h("span", { style: `background:${vars["--cz-text"] ?? "transparent"}` }),
      h("span", { style: `background:${vars["--cz-accent"] ?? "transparent"}` }),
    );
  }

  function renderPlugins(state: AppState): void {
    const plugins = state.plugins;
    pluginList.replaceChildren(
      ...plugins.map((plugin: PluginInfo) => {
        const status = plugin.status;
        const pillClass =
          status === "error"
            ? "status-pill status-pill--error"
            : status === "active" || status === "loaded"
              ? "status-pill"
              : "status-pill status-pill--muted";
        return h(
          "div",
          { class: "plugin-row" },
          h("span", { class: "plugin-row__icon" }, icon("plugins", 18)),
          h(
            "div",
            { class: "settings-row__text" },
            h("p", { class: "plugin-row__name", text: plugin.manifest.name }),
            h("p", {
              class: "plugin-row__meta",
              text: `${plugin.manifest.version}${plugin.manifest.author ? ` | ${plugin.manifest.author}` : ""}${plugin.error ? ` | ${plugin.error}` : ""}`,
            }),
          ),
          h("span", { class: pillClass, text: status }),
        );
      }),
    );
    pluginList.hidden = plugins.length === 0;
    pluginEmpty.hidden = plugins.length > 0;
  }

  function renderPlayback(state: AppState): void {
    resumeToggle.input.checked = state.settings.resumeSession;
    mediaKeysToggle.input.checked = state.settings.mediaKeys;
  }

  function renderAbout(state: AppState): void {
    const versions = ctx.bridge.versions;
    setText(versionLine, `Version ${ctx.actions.version()}${ctx.bridge.demo ? " (browser demo)" : ""}`);
    setText(
      runtimeLine,
      ctx.bridge.demo
        ? `Platform ${ctx.bridge.platform} | Last scan ${state.scannedAt ? new Date(state.scannedAt).toLocaleString() : "never"}`
        : `Platform ${ctx.bridge.platform} | Electron ${versions.electron} | Chrome ${versions.chrome}`,
    );
  }

  function update(state: AppState): void {
    renderFolders(state);
    renderThemes(state);
    renderPlayback(state);
    renderPlugins(state);
    renderAbout(state);
  }

  return { el, update };
}

/* ---------------------------------------------------------------- helpers */

function section(id: SettingsSection, title: string, ...children: HTMLElement[]): HTMLElement {
  return h(
    "section",
    { class: "settings-section", dataset: { settingsSection: id }, attrs: { "aria-labelledby": `settings-${id}-title` } },
    h("h2", { class: "settings-section__title", id: `settings-${id}-title`, text: title }),
    ...children,
  );
}
