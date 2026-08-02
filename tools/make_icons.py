#!/usr/bin/env python3
"""Генератор іконок PWA.

Малює один вихідний макет у високій роздільній здатності й зводить його
до потрібних розмірів. Запускати вручну після зміни макета:

    python3 tools/make_icons.py
"""

from __future__ import annotations

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")

SUPERSAMPLE = 4
BASE = 512

BG = (11, 18, 32)
PAPER = (244, 247, 252)
PAPER_EDGE = (206, 216, 232)
LINE = (150, 165, 190)
ACCENT = (255, 209, 61)
GLASS = (56, 132, 255)


def rr(draw: ImageDraw.ImageDraw, box, radius, **kw) -> None:
    draw.rounded_rectangle(box, radius=radius, **kw)


def draw_layout(size: int, *, bleed: float = 0.0, background: bool = True) -> Image.Image:
    """Малює макет у квадраті `size`.

    `bleed` — частка розміру, на яку зменшується сам знак, щоб лишити
    безпечну зону для maskable-іконок Android (обрізається до кола).
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if background:
        rr(d, (0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=BG)

    # Область знака з урахуванням безпечної зони.
    inset = size * (0.16 + bleed)
    left, top = inset, inset
    right, bottom = size - inset, size - inset
    w = right - left
    h = bottom - top

    # Аркуш декларації.
    sheet = (left, top, left + w * 0.74, bottom)
    rr(d, sheet, radius=int(w * 0.07), fill=PAPER, outline=PAPER_EDGE, width=max(1, int(size * 0.006)))

    # Рядки тексту на аркуші.
    line_x0 = left + w * 0.10
    line_x1 = left + w * 0.60
    line_h = h * 0.052
    gap = h * 0.105
    y = top + h * 0.17
    for i in range(5):
        x1 = line_x1 if i % 2 == 0 else line_x0 + (line_x1 - line_x0) * 0.66
        rr(d, (line_x0, y, x1, y + line_h), radius=line_h / 2, fill=ACCENT if i == 0 else LINE)
        y += gap

    # Лупа поверх аркуша.
    cx = left + w * 0.72
    cy = top + h * 0.66
    r = w * 0.26
    ring = max(2, int(size * 0.035))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=BG)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=GLASS, width=ring)

    # Ручка лупи.
    k = 0.7071
    hx0, hy0 = cx + r * k, cy + r * k
    hx1, hy1 = hx0 + w * 0.17, hy0 + w * 0.17
    d.line((hx0, hy0, hx1, hy1), fill=GLASS, width=ring, joint="curve")
    d.ellipse((hx1 - ring / 2, hy1 - ring / 2, hx1 + ring / 2, hy1 + ring / 2), fill=GLASS)

    return img


def render(path: str, size: int, *, bleed: float = 0.0, background: bool = True) -> None:
    big = draw_layout(size * SUPERSAMPLE, bleed=bleed, background=background)
    img = big.resize((size, size), Image.LANCZOS)
    img.save(path, "PNG", optimize=True)
    print(f"  {os.path.relpath(path, ROOT)}  {size}x{size}")


def main() -> None:
    os.makedirs(ICONS, exist_ok=True)
    print("Генерую іконки:")
    render(os.path.join(ICONS, "icon-192.png"), 192)
    render(os.path.join(ICONS, "icon-512.png"), 512)
    # Maskable: Android обрізає до кола, тому лишаємо ~20% безпечної зони.
    render(os.path.join(ICONS, "maskable-512.png"), 512, bleed=0.08)
    render(os.path.join(ICONS, "apple-touch-icon.png"), 180)
    render(os.path.join(ICONS, "favicon-32.png"), 32)


if __name__ == "__main__":
    main()
