/**
 * Renderer entry: pick the real Electron bridge or the browser demo bridge.
 *
 * `window.cadenza` is injected by `src/preload.cjs` and is the ONLY way the
 * renderer can reach the main process (no node integration, no `electron`
 * import anywhere in this folder). In a plain browser the object is missing and
 * the demo bridge takes over.
 */

import type { CadenzaBridge } from "../shared/ipc.js";
import { createDemoBridge } from "./demo/bridge.js";

declare global {
  interface Window {
    /** Injected by the preload script. Absent in the browser demo. */
    cadenza?: CadenzaBridge;
  }
}

let bridge: CadenzaBridge | null = null;

/**
 * Resolve the host bridge once. The demo bridge is created lazily, so Electron
 * never pays for the sample library.
 */
export function getBridge(): CadenzaBridge {
  if (bridge) return bridge;
  const injected = window.cadenza;
  bridge = isCompleteBridge(injected) ? injected : createDemoBridge();
  if (injected && !isCompleteBridge(injected)) {
    console.warn("Cadenza: window.cadenza is incomplete (old preload?) - using the demo bridge instead");
  }
  return bridge;
}

/** True when running without Electron. */
export function isDemo(): boolean {
  return getBridge().demo === true;
}

/**
 * Guard against a stale preload that only exposes part of the contract: better
 * to fall back to the demo than to crash halfway through the first render.
 */
function isCompleteBridge(candidate: unknown): candidate is CadenzaBridge {
  if (typeof candidate !== "object" || candidate === null) return false;
  const value = candidate as Partial<CadenzaBridge>;
  return (
    typeof value.mediaUrl === "function" &&
    typeof value.demo === "boolean" &&
    typeof value.settings?.all === "function" &&
    typeof value.library?.scan === "function" &&
    typeof value.onCommand === "function"
  );
}
