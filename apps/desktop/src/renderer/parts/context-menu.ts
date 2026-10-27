/**
 * A single re-usable context menu, positioned at the pointer.
 * Used by track rows (right-click), the queue and playlist actions.
 */

import { h, icon, on } from "../dom.js";
import type { MenuEntry, MenuItem, UiContext, ViewPart } from "../state.js";

export interface ContextMenuPart extends ViewPart {
  open(items: MenuEntry[], x: number, y: number): void;
  close(): void;
  isOpen(): boolean;
}

const MARGIN = 10;

export function createContextMenu(_ctx: UiContext): ContextMenuPart {
  const menu = h("div", { class: "context-menu", role: "menu", aria: { label: "Actions" } });
  const layer = h("div", { class: "menu-layer" }, menu);
  layer.hidden = true;

  let opened = false;
  let previousFocus: HTMLElement | null = null;

  function close(): void {
    if (!opened) return;
    opened = false;
    layer.hidden = true;
    menu.replaceChildren();
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }

  function open(items: MenuEntry[], x: number, y: number): void {
    close();
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    for (const entry of items) {
      if ("separator" in entry) {
        menu.append(h("div", { class: "context-menu__sep", attrs: { role: "separator" } }));
        continue;
      }
      menu.append(renderItem(entry));
    }

    if (menu.childElementCount === 0) return;
    layer.hidden = false;
    opened = true;

    // Measure, then clamp inside the viewport.
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - MARGIN;
    const maxY = window.innerHeight - rect.height - MARGIN;
    menu.style.left = `${Math.max(MARGIN, Math.min(x, maxX))}px`;
    menu.style.top = `${Math.max(MARGIN, Math.min(y, maxY))}px`;

    const first = menu.querySelector<HTMLButtonElement>("button:not(:disabled)");
    first?.focus();
  }

  function renderItem(item: MenuItem): HTMLButtonElement {
    return h(
      "button",
      {
        class: item.danger ? "context-menu__item context-menu__item--danger" : "context-menu__item",
        type: "button",
        role: "menuitem",
        disabled: item.disabled === true,
        on: {
          click: () => {
            close();
            item.run();
          },
        },
      },
      h("span", { class: "context-menu__icon" }, item.icon ? icon(item.icon, 15) : null),
      h("span", { class: "context-menu__label", text: item.label }),
      item.shortcut ? h("span", { class: "context-menu__shortcut", text: item.shortcut }) : null,
    );
  }

  /* ------------------------------------------------------------- keyboard */

  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        buttons[(currentIndex + 1) % buttons.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        buttons[(currentIndex - 1 + buttons.length) % buttons.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        buttons[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        buttons[buttons.length - 1]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        event.preventDefault();
        close();
        break;
      default:
        break;
    }
  });

  // Clicking anywhere else closes the menu; the click itself still lands.
  on(document, "pointerdown", (event) => {
    if (!opened) return;
    const target = event.target;
    if (target instanceof Node && menu.contains(target)) return;
    close();
  }, true);

  window.addEventListener("resize", () => close());

  return {
    el: layer,
    open,
    close,
    isOpen(): boolean {
      return opened;
    },
    update(): void {
      // Driven by explicit open()/close() calls, not by app state.
    },
  };
}
