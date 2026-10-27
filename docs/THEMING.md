# Theming

Every colour, radius and shadow in Cadenza is a CSS custom property. A theme is a
list of overrides — there is no stylesheet to patch and no build step.

## Built-in themes

| Id | Name | Look |
| --- | --- | --- |
| `midnight` | Midnight | Near-black glass, violet → cyan accents (default) |
| `daylight` | Daylight | Paper-white surfaces, ink text, same accents |
| `synthwave` | Synthwave | Deep purple, neon magenta, stronger glow |

Switch in **Settings → Appearance**, or with the command palette.

## Tokens

These are the variables the UI kit consumes. Override any subset.

```css
:root {
  /* surfaces */
  --cz-bg: #08090d;
  --cz-bg-soft: #0e1016;
  --cz-surface: #14171f;
  --cz-surface-2: #1b1f29;
  --cz-surface-3: #232834;

  /* lines */
  --cz-border: rgba(255, 255, 255, 0.08);
  --cz-border-strong: rgba(255, 255, 255, 0.14);

  /* type */
  --cz-text: #eef1f8;
  --cz-text-dim: #9aa4bb;
  --cz-text-mute: #6b7488;

  /* accent */
  --cz-accent: #8b5cf6;
  --cz-accent-2: #22d3ee;
  --cz-accent-soft: rgba(139, 92, 246, 0.16);
  --cz-grad: linear-gradient(135deg, #8b5cf6, #22d3ee);

  /* semantic */
  --cz-danger: #f87171;
  --cz-success: #34d399;

  /* shape */
  --cz-radius: 16px;
  --cz-radius-sm: 10px;
  --cz-radius-pill: 999px;
  --cz-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --cz-shadow-2: 0 18px 40px rgba(0, 0, 0, 0.45);

  /* type */
  --cz-font: "Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI",
    system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --cz-mono: "Cascadia Code", ui-monospace, Consolas, monospace;
}
```

## Theme file format

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "author": "Your Name",
  "vars": {
    "--cz-bg": "#0b0b14",
    "--cz-accent": "#ff7ac6",
    "--cz-grad": "linear-gradient(135deg,#ff7ac6,#7c5cff)"
  }
}
```

A theme only needs the variables it changes; everything else falls back to the
built-in values.

## Runtime overrides from a plugin

```js
const undo = ctx.theme.setVar("--cz-accent", "#34d399");
// later
undo.dispose();
```

This is how [`accent-cycle`](../examples/plugins/accent-cycle) works.

## Accessibility

Contrast is checked for the three built-in themes at 4.5:1 for body text and 3:1 for
large text. If you publish a theme, keep `--cz-text` ≥ 4.5:1 against `--cz-bg` and do
not encode meaning in colour alone — the UI also uses icons and labels.

## Writing your own UI

Theming is only the shallow end: `@fanduck/cadenza-ui` exports the components, and
`@fanduck/cadenza-core` has no UI at all. You can throw the reference UI away and
still get a working player — see [EMBEDDING.md](EMBEDDING.md).
