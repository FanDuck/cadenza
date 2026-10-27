/**
 * `<cz-empty-state>` - friendly placeholder for empty views.
 *
 * Properties
 *  - `icon`         icon name from the sprite
 *  - `title`        headline
 *  - `description`  supporting copy
 *  - `actionLabel`  when set, renders a button that emits `cz-action`
 */

import { CzElement } from "../base.js";
import { iconSvg } from "../icons.js";

export class CzEmptyState extends CzElement {
  static override styles = `
    :host {
      display: block;
      color: var(--cz-text, #eef1f8);
    }
    .wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 48px 28px;
      text-align: center;
    }
    .glyph {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 60px;
      height: 60px;
      margin-bottom: 4px;
      border-radius: 50%;
      border: 1px solid var(--cz-border, rgba(255, 255, 255, 0.08));
      background:
        radial-gradient(circle at 30% 20%, var(--cz-accent-soft, rgba(139, 92, 246, 0.16)), transparent 70%),
        var(--cz-surface-2, #1b1f29);
      color: var(--cz-accent, #8b5cf6);
    }
    .title {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .description {
      margin: 0;
      max-width: 380px;
      font-size: 13px;
      line-height: 1.55;
      color: var(--cz-text-dim, #9aa4bb);
    }
    .action {
      margin-top: 8px;
      padding: 8px 18px;
      border: 1px solid var(--cz-border-strong, rgba(255, 255, 255, 0.14));
      border-radius: var(--cz-radius-pill, 999px);
      background: var(--cz-accent-soft, rgba(139, 92, 246, 0.16));
      color: var(--cz-text, #eef1f8);
      font-size: 13px;
      font-weight: 550;
      transition:
        background 150ms ease,
        border-color 150ms ease,
        transform 150ms ease;
    }
    .action:hover {
      background: color-mix(in srgb, var(--cz-accent, #8b5cf6) 30%, transparent);
      border-color: var(--cz-accent, #8b5cf6);
    }
    .action:active {
      transform: scale(0.97);
    }
  `;

  static override get observedAttributes(): string[] {
    return ["icon", "title", "description", "action-label"];
  }

  private iconValue = "music";
  private titleValue = "Nothing here yet";
  private descriptionValue = "";
  private actionLabelValue = "";

  get icon(): string {
    return this.iconValue;
  }

  set icon(value: string) {
    this.iconValue = value || "music";
    this.invalidate();
  }

  override get title(): string {
    return this.titleValue;
  }

  override set title(value: string) {
    this.titleValue = value || "Nothing here yet";
    this.invalidate();
  }

  get description(): string {
    return this.descriptionValue;
  }

  set description(value: string) {
    this.descriptionValue = value || "";
    this.invalidate();
  }

  get actionLabel(): string {
    return this.actionLabelValue;
  }

  set actionLabel(value: string) {
    this.actionLabelValue = value || "";
    this.invalidate();
  }

  override attributeChangedCallback(attributeName: string, _oldValue: string | null, newValue: string | null): void {
    switch (attributeName) {
      case "icon":
        this.icon = newValue ?? "";
        break;
      case "title":
        this.title = newValue ?? "";
        break;
      case "description":
        this.description = newValue ?? "";
        break;
      case "action-label":
        this.actionLabel = newValue ?? "";
        break;
      default:
        break;
    }
  }

  protected override render(): void {
    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.append(iconSvg(this.iconValue, 26));

    const title = document.createElement("h3");
    title.className = "title";
    title.textContent = this.titleValue;

    wrap.append(glyph, title);

    if (this.descriptionValue.length > 0) {
      const description = document.createElement("p");
      description.className = "description";
      description.textContent = this.descriptionValue;
      wrap.append(description);
    }

    if (this.actionLabelValue.length > 0) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "action";
      action.textContent = this.actionLabelValue;
      action.addEventListener("click", () => this.emit("cz-action"));
      wrap.append(action);
    }

    this.replaceContent(wrap);
  }
}
