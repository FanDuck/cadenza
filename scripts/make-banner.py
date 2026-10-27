#!/usr/bin/env python3
"""Render the repository banner / GitHub social preview (1280x640).

One-off asset script. Requires Pillow.

    python scripts/make-banner.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets" / "banner.png"
ICON = ROOT / "apps" / "desktop" / "resources" / "icon.png"

W, H = 1280, 640
BG = (8, 9, 13)
VIOLET = (139, 92, 246)
CYAN = (34, 211, 238)
TEXT = (238, 241, 248)
DIM = (154, 164, 187)


def load_font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


BOLD = ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"]
REG = ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]


def main() -> None:
    canvas = Image.new("RGBA", (W, H), BG + (255,))

    # Two soft colour blooms so the flat background does not look dead.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-220, -260, 560, 420), fill=VIOLET + (70,))
    gd.ellipse((880, 300, 1560, 900), fill=CYAN + (55,))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    canvas = Image.alpha_composite(canvas, glow)

    # Subtle grid dots.
    dots = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    for y in range(40, H, 40):
        for x in range(40, W, 40):
            dd.ellipse((x, y, x + 2, y + 2), fill=(255, 255, 255, 14))
    canvas = Image.alpha_composite(canvas, dots)

    draw = ImageDraw.Draw(canvas)

    # Icon.
    if ICON.exists():
        icon = Image.open(ICON).convert("RGBA").resize((188, 188), Image.LANCZOS)
        canvas.alpha_composite(icon, (96, 150))

    # Wordmark.
    title_font = load_font(BOLD, 108)
    draw.text((320, 150), "Cadenza", font=title_font, fill=TEXT)

    tagline_font = load_font(REG, 34)
    draw.text((326, 274), "A plugin-first music player framework for Windows", font=tagline_font, fill=DIM)

    # Accent rule.
    draw.rounded_rectangle((326, 330, 326 + 96, 336), radius=3, fill=VIOLET)
    draw.rounded_rectangle((426, 330, 426 + 96, 336), radius=3, fill=CYAN)

    # Feature chips.
    chip_font = load_font(REG, 24)
    chips = ["TypeScript", "Electron", "Web Components", "Zero bundler", "MIT"]
    x = 326
    for chip in chips:
        box = draw.textbbox((0, 0), chip, font=chip_font)
        w = box[2] - box[0] + 36
        draw.rounded_rectangle((x, 376, x + w, 376 + 46), radius=23, outline=(255, 255, 255, 46), width=1,
                               fill=(255, 255, 255, 10))
        draw.text((x + 18, 376 + 10), chip, font=chip_font, fill=(214, 220, 235))
        x += w + 14

    # Footer.
    footer_font = load_font(REG, 26)
    draw.text((96, 540), "github.com/FanDuck/cadenza", font=footer_font, fill=(120, 130, 150))
    draw.text((W - 96 - 250, 540), "v0.1.0", font=footer_font, fill=(120, 130, 150))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT, quality=92)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
