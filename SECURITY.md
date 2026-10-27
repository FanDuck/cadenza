# Security policy

## Supported versions

Cadenza is pre-1.0. Only the latest `0.x` release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through GitHub's
[security advisories](https://github.com/FanDuck/cadenza/security/advisories/new) or
by email to the maintainer listed on the GitHub profile.

Include the version, a reproduction, and the impact you believe it has. You can
expect an initial response within a few days.

## Threat model

Cadenza is a local desktop music player. The relevant attack surfaces are:

| Surface | Mitigation |
| --- | --- |
| Untrusted audio files | Metadata parsers are bounds-checked and never throw on malformed input; fuzzed in CI |
| Untrusted playlist files | Parsed as text only; paths are never executed |
| Renderer compromise | `contextIsolation: true`, `nodeIntegration: false`, strict CSP (no inline scripts, no `eval`), navigation and window-open blocked |
| Custom protocols | `app://`, `cadenza-media://` and `cadenza-plugin://` resolve inside allow-listed roots only; path traversal returns 404 |
| Plugins | Plugins are **trusted code** by design (like VS Code extensions). Only install plugins whose source you have read. |

## Out of scope

- Playback of DRM-protected files (not supported).
- Attacks that require the user to run a malicious plugin: installing a plugin is
  equivalent to running a program.
