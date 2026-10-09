#!/usr/bin/env python3
"""生成 Chrome Web Store 的宣传图。

    python3 scripts/make-store-art.py

产出（都在 store/ 下）：
    promo-440x280.png    小宣传图，商店必填
    marquee-1400x560.png 顶部大图，可选

设计沿用扩展图标的语言：emerald 渐变圆角方块 + 白色声波条。
和图标用同一套颜色常量，视觉才是一套东西 —— 商店里图标和宣传图并排出现，
色差会很显眼。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store"

SS = 4  # 超采样倍数，抗锯齿全靠它

# 和 scripts/make-icons.py 保持一致
EMERALD_DEEP = (5, 150, 105)
EMERALD = (16, 185, 129)
EMERALD_BRIGHT = (52, 211, 153)

# 界面主色（slate-900 / slate-950），宣传图用同一套底
BG_TOP = (15, 23, 42)
BG_BOTTOM = (2, 6, 23)

WHITE = (255, 255, 255)
MUTED = (148, 163, 184)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def gradient(size: tuple[int, int], top, bottom, vertical=True) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    span = h if vertical else w
    for i in range(span):
        t = i / max(1, span - 1)
        color = tuple(int(round(lerp(top[c], bottom[c], t))) for c in range(3))
        if vertical:
            for x in range(w):
                px[x, i] = color
        else:
            for y in range(h):
                px[i, y] = color
    return img


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255
    )
    return mask


def draw_wave_bars(draw, size, heights, color, width_ratio=0.70, gap_ratio=0.18):
    """三根圆头竖条，和图标里的完全同一套参数。"""
    n = len(heights)
    total_ratio = n * width_ratio + (n - 1) * gap_ratio
    bar_w = size * width_ratio / total_ratio
    gap = size * gap_ratio / total_ratio
    total_w = n * bar_w + (n - 1) * gap
    x = (size - total_w) / 2
    for h_ratio in heights:
        h = size * h_ratio / 1.0
        y0 = (size + h) / 2 - h
        draw.rounded_rectangle((x, y0, x + bar_w, y0 + h), radius=bar_w / 2, fill=color)
        x += bar_w + gap


def logo(size: int) -> Image.Image:
    """和 public/icon 完全一致的图标（emerald 圆角方块 + 白色声波）。"""
    img = gradient((size, size), EMERALD_BRIGHT, EMERALD_DEEP).convert("RGBA")
    img.putalpha(rounded_mask(size, 0.2237))
    draw_wave_bars(ImageDraw.Draw(img), size, (0.52, 1.0, 0.70), WHITE)
    return img


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """找一个能用的系统字体；找不到就退回 Pillow 内置位图字体。"""
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
        else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def make_promo() -> None:
    """440x280 —— 商店里和图标并排显示的那张小图。"""
    W, H = 440, 280
    img = gradient((W * SS, H * SS), BG_TOP, BG_BOTTOM).convert("RGBA")
    draw = ImageDraw.Draw(img)

    s = SS
    mark = logo(int(96 * s))
    img.paste(mark, (int(40 * s), int(44 * s)), mark)

    draw.text((int(40 * s), int(160 * s)), "ReadX", font=font(52 * s, bold=True), fill=WHITE)
    draw.text(
        (int(42 * s), int(220 * s)),
        "Listen to your X timeline",
        font=font(21 * s),
        fill=EMERALD_BRIGHT,
    )

    img.resize((W, H), Image.LANCZOS).convert("RGB").save(OUT / "promo-440x280.png")


def make_marquee() -> None:
    """1400x560 —— 商店顶部大图（可选，但有了更完整）。"""
    W, H = 1400, 560
    img = gradient((W * SS, H * SS), BG_TOP, BG_BOTTOM).convert("RGBA")
    draw = ImageDraw.Draw(img)

    s = SS
    mark = logo(int(132 * s))
    img.paste(mark, (int(120 * s), int(120 * s)), mark)

    draw.text((int(120 * s), int(292 * s)), "ReadX", font=font(88 * s, bold=True), fill=WHITE)
    draw.text(
        (int(124 * s), int(406 * s)),
        "Turn your X timeline into something you can listen to.",
        font=font(30 * s),
        fill=EMERALD_BRIGHT,
    )

    # 右侧三条声波，暗示"在朗读"
    bars = Image.new("RGBA", (int(420 * s), int(240 * s)), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(bars)
    heights = (0.30, 0.55, 0.82, 1.0, 0.72, 0.44, 0.26)
    n = len(heights)
    unit = int(420 * s) / (n * 1.6)
    x = 0.0
    for h_ratio in heights:
        h = int(240 * s) * h_ratio
        y0 = (int(240 * s) - h) / 2
        bdraw.rounded_rectangle(
            (x, y0, x + unit * 0.5, y0 + h), radius=unit * 0.25, fill=(*EMERALD, 200)
        )
        x += unit
    img.paste(bars, (int(880 * s), int(170 * s)), bars)

    img.resize((W, H), Image.LANCZOS).convert("RGB").save(OUT / "marquee-1400x560.png")


def main() -> int:
    OUT.mkdir(exist_ok=True)
    try:
        from PIL import Image as _  # noqa: F401
    except ImportError:
        print("需要 Pillow：pip install Pillow", file=sys.stderr)
        return 1

    make_promo()
    make_marquee()
    for name in ("promo-440x280.png", "marquee-1400x560.png"):
        path = OUT / name
        with Image.open(path) as im:
            print(f"  ✓ {path.relative_to(ROOT)}  {im.width}×{im.height}  {path.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
