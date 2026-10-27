/**
 * Shared CSS fragments injected into every Cadenza element's shadow root.
 *
 * The reset is scoped to the shadow tree on purpose: the kit must never leak
 * global styles into a host application. Keep this file free of component
 * specific rules; those live in each component's `static styles`.
 */

/** Minimal, well-behaved reset for shadow trees. */
export const RESET_CSS = `
:host {
  box-sizing: border-box;
  font-family: var(--cz-font, "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif);
  color: var(--cz-text, #eef1f8);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
[hidden] {
  display: none !important;
}
img,
svg,
canvas {
  display: block;
  max-width: 100%;
}
`;

/** Slim scrollbars that match the glass surfaces. */
export const SCROLLBAR_CSS = `
* {
  scrollbar-width: thin;
  scrollbar-color: var(--cz-border-strong, rgba(255, 255, 255, 0.14)) transparent;
}
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--cz-border-strong, rgba(255, 255, 255, 0.14));
  background-clip: padding-box;
  border: 2px solid transparent;
  border-radius: var(--cz-radius-pill, 999px);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--cz-text-mute, #6b7488);
  background-clip: padding-box;
  border: 2px solid transparent;
}
::-webkit-scrollbar-corner {
  background: transparent;
}
`;

/** Accent focus ring, only for keyboard users. */
export const FOCUS_CSS = `
:focus {
  outline: none;
}
:focus-visible {
  outline: 2px solid var(--cz-accent, #8b5cf6);
  outline-offset: 2px;
}
::selection {
  background: var(--cz-accent-soft, rgba(139, 92, 246, 0.3));
  color: var(--cz-text, #eef1f8);
}
`;

/** Button reset so every control starts from the same slate. */
export const BUTTON_CSS = `
button {
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  line-height: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
button:disabled {
  cursor: default;
}
button svg {
  pointer-events: none;
}
`;

/** Reduce motion everywhere the kit animates. */
export const MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

/**
 * The complete stylesheet base.ts prepends to every element's `static styles`.
 * It is built once at module evaluation and cached by the base class machinery.
 */
export const BASE_STYLES = `${RESET_CSS}\n${SCROLLBAR_CSS}\n${FOCUS_CSS}\n${BUTTON_CSS}\n${MOTION_CSS}`;
