/**
 * Hello World - the smallest useful Cadenza plugin.
 *
 * Install: copy this folder into
 *   %APPDATA%\Cadenza\plugins\hello-world\
 * then click "Reload plugins" in Settings → Plugins.
 *
 * A plugin is a plain ES module. No build step, no dependencies.
 */

export default {
  /**
   * Called once when the plugin is loaded.
   * @param {import("@fanduck/cadenza-core").PluginContext} ctx
   */
  activate(ctx) {
    ctx.log("activated");

    // 1. A command appears in the command palette (Ctrl+K).
    ctx.commands.register({
      id: "hello-world.greet",
      title: "Hello World: greet me",
      keywords: ["demo", "example", "hello"],
      run() {
        ctx.log(`Hello from ${ctx.pluginId}! Library has ${ctx.library.tracks().length} tracks.`);
      },
    });

    // 2. A button in the sidebar footer.
    ctx.ui.slot("sidebar:footer", (host) => {
      const button = host.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "cz-plugin-hello";
      button.textContent = "👋 Wave";
      button.title = "A button injected by the hello-world example plugin";
      button.addEventListener("click", () => {
        const track = ctx.player.snapshot().track;
        ctx.log(track ? `Now playing: ${track.title} — ${track.artist}` : "Nothing is playing.");
      });
      host.append(button);
    });

    // 3. React to playback without polling.
    const subscription = ctx.player.on("trackchange", (snapshot) => {
      if (snapshot.track) ctx.log(`track changed → ${snapshot.track.title}`);
    });
    this._subscription = subscription;
  },

  deactivate() {
    this._subscription?.dispose();
    this._subscription = undefined;
  },
};
