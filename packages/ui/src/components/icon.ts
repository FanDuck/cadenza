/**
 * `<cz-icon name size>` - an inline SVG sprite element.
 *
 * - `name`  icon name (see `icons.ts`); unknown names fall back to `music`.
 * - `size`  square size in CSS pixels (default 20).
 *
 * The element is decorative (`aria-hidden`): put the accessible name on the
 * button or control that contains it.
 */

import { CzElement } from "../base.js";
import { paintIcon, resolveIconName, type IconName } from "../icons.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export class CzIcon extends CzElement {
  static override styles = `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      line-height: 0;
      color: inherit;
      vertical-align: middle;
    }
    svg {
      display: block;
      overflow: visible;
    }
  `;

  static override get observedAttributes(): string[] {
    return ["name", "size"];
  }

  private iconName: IconName = "music";
  private iconSize = 20;
  private svg: SVGSVGElement | null = null;

  get name(): string {
    return this.iconName;
  }

  set name(value: string) {
    this.iconName = resolveIconName(value);
    this.invalidate();
  }

  get size(): number {
    return this.iconSize;
  }

  set size(value: number) {
    const next = Number(value);
    this.iconSize = Number.isFinite(next) ? Math.min(512, Math.max(8, Math.round(next))) : 20;
    this.invalidate();
  }

  override attributeChangedCallback(attributeName: string, _oldValue: string | null, newValue: string | null): void {
    if (attributeName === "name") {
      this.name = newValue ?? "";
    } else if (attributeName === "size") {
      this.size = newValue === null ? 20 : Number(newValue);
    }
  }

  protected override render(): void {
    if (!this.svg) {
      this.svg = document.createElementNS(SVG_NS, "svg");
      this.root.replaceChildren(this.svg);
    }
    paintIcon(this.svg, this.iconName, this.iconSize);
  }
}
