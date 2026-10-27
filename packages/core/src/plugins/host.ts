/**
 * Loads, activates and isolates plugins.
 *
 * A plugin is just an ES module: it may export a `default` CadenzaPlugin, or
 * named `activate`/`deactivate` functions. Failures are contained per plugin so
 * one broken plugin can never take the player down.
 */

import { EventBus } from "../events.js";
import type { CadenzaPlugin, Command, CoreEvents, Disposable, PluginContext, PluginInfo } from "../types.js";
import type { PluginHostBridge } from "./context.js";

/** Shape of an imported plugin module. */
export interface PluginModule {
  default?: CadenzaPlugin;
  activate?: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

/** Wiring needed to construct a {@link PluginHost}. */
export interface PluginHostOptions {
  /** Shared event bus. A private bus is created when omitted. */
  bus?: EventBus<CoreEvents>;
  /** Factory for the per-plugin API surface; usually `createPluginContext`. */
  createContext: (info: PluginInfo) => PluginContext;
  /** Imports a plugin entry URL. Defaults to a dynamic `import()`. */
  loader?: (url: string) => Promise<PluginModule>;
}

const defaultLoader = (url: string): Promise<PluginModule> => import(/* @vite-ignore */ url) as Promise<PluginModule>;

/**
 * Plugin lifecycle manager.
 *
 * Register discovered plugins with {@link register}, then call
 * {@link activateAll}. Resources created through each plugin's
 * `PluginContext` are tracked and released by {@link deactivateAll}.
 */
export class PluginHost implements PluginHostBridge {
  /** Commands contributed by every active plugin, in registration order. */
  readonly commands: Command[] = [];

  private readonly bus: EventBus<CoreEvents>;
  private readonly plugins: PluginInfo[] = [];
  private readonly createContext: (info: PluginInfo) => PluginContext;
  private readonly loader: (url: string) => Promise<PluginModule>;
  private readonly contexts = new Map<string, PluginContext>();
  private readonly disposables = new Map<string, Disposable[]>();
  private readonly deactivators = new Map<string, () => void | Promise<void>>();

  constructor(options: PluginHostOptions) {
    this.bus = options.bus ?? new EventBus<CoreEvents>();
    this.createContext = options.createContext;
    this.loader = options.loader ?? defaultLoader;
  }

  /** All registered plugins, in registration order. */
  get list(): PluginInfo[] {
    return this.plugins.slice();
  }

  /** Add (or update) a discovered plugin. Returns the stored info object. */
  register(info: PluginInfo): PluginInfo {
    const existing = this.plugins.find((plugin) => plugin.manifest.id === info.manifest.id);
    if (existing) {
      existing.manifest = info.manifest;
      existing.entryUrl = info.entryUrl;
      // Re-registering a plugin resets a previous error so it can be retried;
      // an active plugin keeps its status until it is deactivated.
      if (existing.status !== "active") existing.status = info.status;
    } else {
      this.plugins.push(info);
    }
    this.emitPlugins();
    return info;
  }

  /** Import and activate every plugin that is not active, disabled or failed. */
  async activateAll(): Promise<void> {
    for (const info of this.list) {
      if (info.status === "active" || info.status === "disabled" || info.status === "error") continue;
      await this.activatePlugin(info);
    }
  }

  /** Deactivate every plugin and release the resources it owns. */
  async deactivateAll(): Promise<void> {
    for (const info of this.list) {
      if (!this.contexts.has(info.manifest.id) && !this.disposables.has(info.manifest.id)) continue;
      await this.deactivatePlugin(info);
    }
  }

  /**
   * Run a command by id. Returns `false` when the command is unknown or threw;
   * command errors are reported on the bus as `app:error` with scope "plugin".
   */
  async runCommand(id: string): Promise<boolean> {
    const command = this.commands.find((candidate) => candidate.id === id);
    if (!command) return false;
    try {
      await command.run();
      return true;
    } catch (error) {
      this.bus.emit("app:error", { scope: "plugin", message: describeError(error) });
      return false;
    }
  }

  /* --------------------------------------------------- PluginHostBridge */

  /** Register a plugin command. The returned disposable removes it again. */
  registerCommand(pluginId: string, command: Command): Disposable {
    this.commands.push(command);
    const disposable: Disposable = {
      dispose: () => {
        const index = this.commands.indexOf(command);
        if (index >= 0) this.commands.splice(index, 1);
      },
    };
    this.trackDisposable(pluginId, disposable);
    return disposable;
  }

  /** Remember a disposable so it is released when the plugin is deactivated. */
  trackDisposable(pluginId: string, disposable: Disposable): void {
    const owned = this.disposables.get(pluginId);
    if (owned) owned.push(disposable);
    else this.disposables.set(pluginId, [disposable]);
  }

  /* ------------------------------------------------------------ internals */

  private async activatePlugin(info: PluginInfo): Promise<void> {
    const id = info.manifest.id;
    try {
      info.status = "loaded";
      info.error = undefined;

      const context = this.createContext(info);
      this.contexts.set(id, context);

      const module = await this.loader(info.entryUrl);
      const plugin = module.default;
      if (plugin) {
        await plugin.activate(context);
        if (plugin.deactivate) this.deactivators.set(id, () => plugin.deactivate?.());
      } else if (module.activate) {
        await module.activate(context);
        if (module.deactivate) this.deactivators.set(id, () => module.deactivate?.());
      } else {
        throw new Error(`Plugin "${id}" does not export an activate() function`);
      }

      info.status = "active";
    } catch (error) {
      const message = describeError(error);
      info.status = "error";
      info.error = message;
      this.bus.emit("plugin:error", { id, message });
    } finally {
      this.emitPlugins();
    }
  }

  private async deactivatePlugin(info: PluginInfo): Promise<void> {
    const id = info.manifest.id;
    const deactivate = this.deactivators.get(id);
    this.deactivators.delete(id);

    try {
      if (deactivate) await deactivate();
      if (info.status === "active") info.status = "loaded";
    } catch (error) {
      const message = describeError(error);
      info.status = "error";
      info.error = message;
      this.bus.emit("plugin:error", { id, message });
    }

    const owned = this.disposables.get(id);
    this.disposables.delete(id);
    if (owned) {
      for (const disposable of owned.reverse()) {
        try {
          disposable.dispose();
        } catch {
          // Keep releasing the rest even if one resource misbehaves.
        }
      }
    }
    this.contexts.delete(id);
    if (info.status !== "error") info.error = undefined;
    this.emitPlugins();
  }

  private emitPlugins(): void {
    this.bus.emit("plugins:change", this.list);
  }
}

/** Normalise an unknown thrown value to a message. */
function describeError(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Unknown plugin error";
}
