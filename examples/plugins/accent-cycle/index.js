/**
 * Accent Cycle - demonstrates the theme API.
 *
 * Every colour in Cadenza comes from a CSS custom property, so a plugin can
 * re-skin the app at runtime without touching anyone's stylesheet.
 */

const ACCENTS = [
  { name: "Violet", accent: "#8b5cf6", second: "#22d3ee" },
  { name: "Sunset", accent: "#f97316", second: "#f43f5e" },
  { name: "Forest", accent: "#22c55e", second: "#a3e635" },
  { name: "Ocean", accent: "#0ea5e9", second: "#6366f1" },
  { name: "Mono", accent: "#e5e7eb", second: "#9ca3af" },
];

export default {
  activate(ctx) {
    let index = 0;
    /** @type {Array<{ dispose(): void }>} */
    let handles = [];

    const apply = () => {
      for (const handle of handles) handle.dispose();
      const palette = ACCENTS[index] ?? ACCENTS[0];
      handles = [
        ctx.theme.setVar("--cz-accent", palette.accent),
        ctx.theme.setVar("--cz-accent-2", palette.second),
        ctx.theme.setVar("--cz-grad", `linear-gradient(135deg, ${palette.accent}, ${palette.second})`),
      ];
      ctx.log(`accent → ${palette.name}`);
      return palette.name;
    };

    ctx.commands.register({
      id: "accent-cycle.next",
      title: "Accent Cycle: next colour",
      keywords: ["theme", "colour", "accent"],
      run() {
        index = (index + 1) % ACCENTS.length;
        apply();
      },
    });

    ctx.ui.slot("settings:section", (host) => {
      const doc = host.ownerDocument;
      const wrap = doc.createElement("div");
      wrap.style.display = "flex";
      wrap.style.gap = "8px";
      wrap.style.alignItems = "center";

      const label = doc.createElement("span");
      label.textContent = "Accent (example plugin):";
      label.style.fontSize = "13px";
      label.style.color = "var(--cz-text-dim)";

      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = "Cycle";
      button.style.cssText =
        "padding:6px 12px;border-radius:8px;border:1px solid var(--cz-border);background:var(--cz-surface-2);color:var(--cz-text);cursor:pointer";
      button.addEventListener("click", () => {
        index = (index + 1) % ACCENTS.length;
        apply();
      });

      wrap.append(label, button);
      host.append(wrap);
    });

    apply();
  },
};
