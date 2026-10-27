/**
 * `<cz-toast-host>` -bottom-centre glass toast stack.
 *
 * Usage: put one host in the app shell, then call
 *
 *     const host = document.querySelector("cz-toast-host");
 *     host.show("Library scanned - 1,204 tracks", "success");
 *
 * `show(message, kind = "info", durationMs = 3200)`. Toasts stack, auto-dismiss
 * with a fade, and can be dismissed by hand. Messages are always written with
 * `textContent`; nothing is interpreted as HTML.
 */

import { CzElement } from "../base.js";
import { iconSvg } from "../icons.js";

export type ToastKind = "info" | "success" | "error";

const DEFAULT_DURATION = 3200;
const EXIT_DURATION = 180;
const MAX_STACK = 5;

function iconFor(kind: ToastKind): string {
  if (kind === "success") return "check";
  if (kind === "error") return "info";
  return "info";
}

export class CzToastHost extends CzElement {
  static override styles = `
    :host {
      position: fixed;
      left: 50%;
      bottom: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      transform: translateX(-50%);
      pointer-events: none;
      font-family: var(--cz-font, "Segoe UI", system-ui, sans-serif);
    }
    .toast {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 220px;
      max-width: min(520px, 90vw);
      padding: 11px 12px 11px 14px;
      border: 1px solid var(--cz-border-strong, rgba(255, 255, 255, 0.14));
      border-radius: 12px;
      background: color-mix(in srgb, var(--cz-surface-2, #1b1f29) 92%, transparent);
      box-shadow: var(--cz-shadow-2, 0 18px 40px rgba(0, 0, 0, 0.45));
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      color: var(--cz-text, #eef1f8);
      font-size: 13px;
      line-height: 1.4;
      pointer-events: auto;
      animation: cz-toast-in 180ms cubic-bezier(0.2, 0, 0, 1);
    }
    .toast.out {
      animation: cz-toast-out 180ms ease forwards;
    }
    .icon {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--cz-accent-soft, rgba(139, 92, 246, 0.16));
      color: var(--cz-accent-2, #22d3ee);
    }
    .toast.success .icon {
      background: color-mix(in srgb, var(--cz-success, #34d399) 18%, transparent);
      color: var(--cz-success, #34d399);
    }
    .toast.error {
      border-color: color-mix(in srgb, var(--cz-danger, #f87171) 40%, transparent);
    }
    .toast.error .icon {
      background: color-mix(in srgb, var(--cz-danger, #f87171) 18%, transparent);
      color: var(--cz-danger, #f87171);
    }
    .message {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .close {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      color: var(--cz-text-mute, #6b7488);
      transition:
        color 150ms ease,
        background 150ms ease;
    }
    .close:hover {
      color: var(--cz-text, #eef1f8);
      background: color-mix(in srgb, var(--cz-text, #eef1f8) 8%, transparent);
    }
    @keyframes cz-toast-in {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    @keyframes cz-toast-out {
      from {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      to {
        opacity: 0;
        transform: translateY(6px) scale(0.98);
      }
    }
  `;

  private readonly timers = new Map<HTMLElement, number>();

  /** Toasts are appended imperatively by show(); nothing to build up front. */
  protected override render(): void {
    // no-op
  }

  /** Queue a toast; returns nothing so callers cannot leak the element. */
  show(message: string, kind: ToastKind = "info", durationMs = DEFAULT_DURATION): void {
    const toast = document.createElement("div");
    toast.className = `toast ${kind}`;
    toast.setAttribute("role", kind === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.append(iconSvg(iconFor(kind), 14));

    const text = document.createElement("span");
    text.className = "message";
    text.textContent = message;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.append(iconSvg("close", 12));
    close.addEventListener("click", () => this.dismiss(toast));

    toast.append(icon, text, close);
    this.root.append(toast);

    const live = Array.from(this.root.querySelectorAll<HTMLElement>(".toast"));
    while (live.length > MAX_STACK) {
      const oldest = live.shift();
      if (oldest) this.dismiss(oldest, 0);
    }

    const duration = Number.isFinite(durationMs) ? Math.max(800, durationMs) : DEFAULT_DURATION;
    const timer = window.setTimeout(() => this.dismiss(toast), duration);
    this.timers.set(toast, timer);
  }

  /** Dismiss every visible toast immediately. */
  dismissAll(): void {
    for (const toast of Array.from(this.root.querySelectorAll<HTMLElement>(".toast"))) {
      this.dismiss(toast, 0);
    }
  }

  private dismiss(toast: HTMLElement, delay = EXIT_DURATION): void {
    const timer = this.timers.get(toast);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(toast);
    }
    if (!toast.isConnected && toast.parentNode === null) return;
    toast.classList.add("out");
    window.setTimeout(() => {
      this.timers.delete(toast);
      toast.remove();
    }, delay);
  }

  override disconnectedCallback(): void {
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
  }
}

