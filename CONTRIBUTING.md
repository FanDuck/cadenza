# Contributing to Cadenza

Thanks for wanting to help. This project is deliberately friendly to people who are
new to programming — "I don't know how to do X" is a perfectly good question here.

## Getting set up

Requirements: **Windows 10/11**, [Node.js](https://nodejs.org) 20 or newer, and
[pnpm](https://pnpm.io) 9 or newer. The test suite runs `.ts` files directly, which
needs Node 22.18+ (24 recommended); building and running the app works on Node 20.

```powershell
git clone https://github.com/FanDuck/cadenza.git
cd cadenza
pnpm install
pnpm build
pnpm start        # launches the desktop player
```

Useful scripts:

| Command | What it does |
| --- | --- |
| `pnpm build` | Compiles every package with `tsc` (no bundler) |
| `pnpm start` | Builds and launches the Electron app |
| `pnpm dev` | Same, with DevTools attached |
| `pnpm demo` | Opens the browser demo with sample data (no Electron needed) |
| `pnpm test` | Builds, then runs the whole test suite |
| `pnpm typecheck` | Builds (types of the workspace packages are generated), then type-checks |
| `pnpm screenshot` | Writes `screenshots/app.png` from a running window |

## Ground rules

1. **No bundler, no framework, no native modules.** The renderer is plain ES modules
   compiled by `tsc`. Every dependency has to earn its place; a PR that adds React,
   Vite, a CSS framework or a native addon will be declined.
2. **Core stays host-agnostic.** `packages/core` may not import `electron`, `node:fs`,
   or touch the DOM (the optional `HtmlAudioSink` aside).
3. **Tests come with behaviour.** Pure logic in `core` needs a `node:test` test.
   UI changes need either a jsdom test or a screenshot in the PR.
4. **Keep it readable.** This codebase is also a teaching material: prefer a clear
   function over a clever one-liner, and comment the *why*, not the *what*.

## Project layout

```
packages/core    engine: player, queue, library, metadata, lyrics, playlists, plugins
packages/ui      <cz-*> Web Components + theme tokens
apps/desktop     Electron main + preload + reference renderer
examples/        sample plugins and themes
docs/            architecture, plugin API, theming, embedding
```

## Making a change

```powershell
git checkout -b feat/my-thing
# ... edit ...
pnpm typecheck
pnpm test
pnpm build
git commit -m "feat: describe the thing"
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

Then open a pull request against `main` and fill in the template. CI runs on Windows
and must be green.

## Adding a plugin example

Plugins live in `examples/plugins/<id>/` with a `cadenza.plugin.json` and an `index.js`.
Keep them dependency-free and small; they double as documentation.

## Reporting bugs

Include the Cadenza version, your Windows version, and the exact steps. If the app
misbehaves visually, a screenshot or a screen recording is worth a thousand words.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be decent to
each other.
