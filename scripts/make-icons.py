#!/usr/bin/env python3
"""Generate Cadenza's raster assets (app icon + taskbar glyphs).

This is a one-off asset script, not part of the build. Run it only when the
branding changes:

    python scripts/make-icons.py

Requires Pillow (pip install pillow).
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RESOURCES = ROOT / "apps" / "desktop" / "resources"
TASKBAR = RESOURCES / "taskbar"

VIOLET = (139, 92, 246)
CYAN = (34, 211, 238)


def linear_gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    """Diagonal gradient, top-left -> bottom-right."""
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = (
                round(start[0] + (end[0] - start[0]) * t),
                round(start[1] + (end[1] - start[1]) * t),
                round(start[2] + (end[2] - start[2]) * t),
                255,
            )
    return image


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in ("C:/Windows/Fonts/seguisym.ttf", "C:/Windows/Fonts/segoeui.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_app_icon(size: int = 512) -> Image.Image:
    base = linear_gradient(size, VIOLET, CYAN)

    # Soft radial highlight in the top-left corner.
    glow = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(glow)
    for i in range(28, 0, -1):
        alpha = int(3 + (28 - i) * 0.9)
        radius = int(size * 0.55 * i / 28)
        draw.ellipse(
            (int(size * 0.08) - radius // 2, int(size * 0.02) - radius // 2,
             int(size * 0.08) + radius, int(size * 0.02) + radius),
            fill=(255, 255, 255, alpha),
        )
    base = Image.alpha_composite(base, glow)

    # Vinyl disc: a single thin white ring.
    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(disc)
    cx, cy = size / 2, size / 2
    outer = size * 0.345
    d.ellipse(
        (cx - outer, cy - outer, cx + outer, cy + outer),
        outline=(255, 255, 255, 210),
        width=max(3, int(size * 0.018)),
    )
    base = Image.alpha_composite(base, disc)

    # Eighth note in the middle, slightly rotated, in near-white.
    note = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    nf = font(int(size * 0.44))
    nd = ImageDraw.Draw(note)
    text = "\u266b"
    box = nd.textbbox((0, 0), text, font=nf)
    tw, th = box[2] - box[0], box[3] - box[1]
    nd.text((cx - tw / 2 - box[0], cy - th / 2 - box[1]), text, font=nf, fill=(255, 255, 255, 252))
    note = note.rotate(-6, resample=Image.BICUBIC, center=(cx, cy))
    base = Image.alpha_composite(base, note)

    base.putalpha(rounded_mask(size, int(size * 0.23)))
    return base


def glyph(shape: str, size: int = 16) -> Image.Image:
    """White transport glyph on transparency for the Windows thumbar."""
    scale = 4  # draw big, downscale for clean edges
    s = size * scale
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    white = (255, 255, 255, 255)
    pad = s * 0.18

    if shape == "play":
        draw.polygon([(pad, pad * 0.7), (pad, s - pad * 0.7), (s - pad * 0.8, s / 2)], fill=white)
    elif shape == "pause":
        w = s * 0.16
        gap = s * 0.12
        top, bottom = pad, s - pad
        draw.rounded_rectangle((s / 2 - gap / 2 - w, top, s / 2 - gap / 2, bottom), radius=w * 0.35, fill=white)
        draw.rounded_rectangle((s / 2 + gap / 2, top, s / 2 + gap / 2 + w, bottom), radius=w * 0.35, fill=white)
    elif shape == "next":
        draw.polygon([(pad, pad), (pad, s - pad), (s * 0.62, s / 2)], fill=white)
        draw.rectangle((s * 0.66, pad, s * 0.66 + s * 0.14, s - pad), fill=white)
    elif shape == "previous":
        draw.polygon([(s - pad, pad), (s - pad, s - pad), (s * 0.38, s / 2)], fill=white)
        draw.rectangle((s * 0.34 - s * 0.14, pad, s * 0.34, s - pad), fill=white)
    else:
        raise ValueError(shape)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    RESOURCES.mkdir(parents=True, exist_ok=True)
    TASKBAR.mkdir(parents=True, exist_ok=True)

    icon = make_app_icon(512)
    icon.save(RESOURCES / "icon.png")
    icon.resize((256, 256), Image.LANCZOS).save(RESOURCES / "icon-256.png")
    icon.save(
        RESOURCES / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    for shape in ("play", "pause", "next", "previous"):
        g = glyph(shape, 32)
        g.save(TASKBAR / f"{shape}.png")

    print("wrote icon.png, icon-256.png, icon.ico and 4 taskbar glyphs")


if __name__ == "__main__":
    main()
