#!/usr/bin/env python3
"""
ReadX 图标生成器。

为什么用脚本而不是手绘导出：图标要出 5 个尺寸（16/32/48/96/128），
而且未来大概率还要微调配色。脚本化之后改一个参数就能重出全套。

关键约束：**必须在 16×16 下能认出来** —— 那是 Chrome 工具栏的实际尺寸。
所以所有方案都先在 8 倍超采样下绘制，再降采样；并且在 16px 下逐个检查。

    python3 scripts/make-icons.py variants   # 出方案对比图
    python3 scripts/make-icons.py build      # 出正式图标到 public/icon/
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "public" / "icon"
PREVIEW_DIR = ROOT / ".icon-preview"

SS = 8  # 超采样倍数，抗锯齿全靠它

# 品牌色 —— 和扩展界面里的 emerald 强调色保持一致
EMERALD_DEEP = (5, 150, 105)     # #059669
EMERALD = (16, 185, 129)         # #10b981
EMERALD_BRIGHT = (52, 211, 153)  # #34d399
WHITE = (255, 255, 255)

SIZES = [16, 32, 48, 96, 128]


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def vertical_gradient(size, top, bottom):
    """竖直渐变。Pillow 没有原生渐变，逐行画。"""
    img = Image.new("RGB", (1, size))
    px = img.load()
    for y in range(size):
        px[0, y] = lerp(top, bottom, y / max(1, size - 1))
    return img.resize((size, size), Image.NEAREST)


def rounded_mask(size, radius_ratio):
    """圆角方形遮罩，用来把渐变裁成 app badge 的形状。"""
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255
    )
    return mask


def draw_wave_bars(draw, size, heights, color, width_ratio=0.62, gap_ratio=0.16, cap=True):
    """
    音频波形：若干根竖直圆头条，高度不一。
    这是 16px 下最站得住的「声音」符号 —— 形状简单、对比强。

    gap_ratio 很关键：16px 时整块 mark 只有约 10px 宽，三根柱子平摊下来
    每根约 2.2px。间距必须留到 ~1.5px 才不会在降采样后粘成一坨。
    """
    n = len(heights)
    mark_w = size * width_ratio
    gap = mark_w * gap_ratio
    bar_w = (mark_w - gap * (n - 1)) / n
    x0 = (size - mark_w) / 2
    mid = size / 2
    max_h = size * 0.48

    for i, h in enumerate(heights):
        bar_h = max_h * h
        x = x0 + i * (bar_w + gap)
        y = mid - bar_h / 2
        box = (x, y, x + bar_w, y + bar_h)
        if cap:
            draw.rounded_rectangle(box, radius=bar_w / 2, fill=color)
        else:
            draw.rectangle(box, fill=color)


def draw_text_lines(draw, size, color, ratios):
    """横向的文字行 —— 用来表达「读」。"""
    n = len(ratios)
    line_h = size * 0.085
    gap = size * 0.075
    total = n * line_h + (n - 1) * gap
    y0 = (size - total) / 2
    x0 = size * 0.24

    for i, r in enumerate(ratios):
        y = y0 + i * (line_h + gap)
        w = size * 0.52 * r
        draw.rounded_rectangle((x0, y, x0 + w, y + line_h), radius=line_h / 2, fill=color)


def draw_play(draw, size, color):
    """播放三角。"""
    s = size * 0.40
    cx, cy = size * 0.46, size / 2
    draw.polygon(
        [(cx - s * 0.34, cy - s * 0.52), (cx - s * 0.34, cy + s * 0.52), (cx + s * 0.56, cy)],
        fill=color,
    )


def draw_arcs(draw, size, color):
    """播放三角右边的两道弧 —— 声音。"""
    for i, r in enumerate((0.30, 0.44)):
        w = size * 0.052
        box = (
            size * 0.72 - size * r,
            size / 2 - size * r,
            size * 0.72 + size * r,
            size / 2 + size * r,
        )
        draw.arc(box, start=-58, end=58, fill=color, width=round(w))


# --------------------------------------------------------------------- 方案

def variant_badge_wave(size, bars=(0.52, 1.0, 0.70), width_ratio=0.70, gap_ratio=0.18):
    """A：翡翠 badge + 白色波形条（当前选定方案）"""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = vertical_gradient(s, EMERALD_BRIGHT, EMERALD_DEEP).convert("RGBA")
    img.paste(grad, (0, 0), rounded_mask(s, 0.2237))
    draw_wave_bars(
        ImageDraw.Draw(img), s, bars, WHITE, width_ratio=width_ratio, gap_ratio=gap_ratio
    )
    return img.resize((size, size), Image.LANCZOS)


def variant_badge_play(size):
    """B：翡翠 badge + 播放三角 + 声波弧"""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = vertical_gradient(s, EMERALD_BRIGHT, EMERALD_DEEP).convert("RGBA")
    img.paste(grad, (0, 0), rounded_mask(s, 0.2237))
    d = ImageDraw.Draw(img)
    draw_play(d, s, WHITE)
    draw_arcs(d, s, WHITE)
    return img.resize((size, size), Image.LANCZOS)


def variant_badge_text_wave(size):
    """C：翡翠 badge + 文字行（末行变成波形）"""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = vertical_gradient(s, EMERALD_BRIGHT, EMERALD_DEEP).convert("RGBA")
    img.paste(grad, (0, 0), rounded_mask(s, 0.2237))
    d = ImageDraw.Draw(img)
    draw_text_lines(d, s, WHITE, (1.0, 0.78))
    # 第三行位置换成三根小波形条
    line_h = s * 0.085
    gap = s * 0.075
    y = (s - (3 * line_h + 2 * gap)) / 2 + 2 * (line_h + gap) + line_h / 2
    for i, h in enumerate((0.5, 1.0, 0.68)):
        bw = s * 0.062
        bx = s * 0.24 + i * (bw + s * 0.05)
        bh = s * 0.20 * h
        d.rounded_rectangle((bx, y - bh / 2, bx + bw, y + bh / 2), radius=bw / 2, fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def variant_bare_wave(size, bars=(0.40, 0.86, 0.58, 1.0)):
    """D：不要 badge，只有翡翠色波形（透明背景）"""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw_wave_bars(ImageDraw.Draw(img), s, bars, EMERALD + (255,), width_ratio=0.76)
    return img.resize((size, size), Image.LANCZOS)


def variant_dark_badge_wave(size, bars=(0.40, 0.86, 0.58, 1.0)):
    """E：深色 badge + 翡翠波形（和 X 的深色界面更搭）"""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = vertical_gradient(s, (30, 41, 59), (2, 6, 23)).convert("RGBA")
    img.paste(grad, (0, 0), rounded_mask(s, 0.2237))
    draw_wave_bars(ImageDraw.Draw(img), s, bars, EMERALD_BRIGHT + (255,))
    return img.resize((size, size), Image.LANCZOS)


def variant_bubble(size, bars=(0.55, 1.0, 0.72)):
    """
    F：白色实心对话气泡，里面的波形是"抠出来"的（露出底色）。
    比纯波形多一点「说话」的语义，轮廓在 16px 下也还算完整。
    """
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = vertical_gradient(s, EMERALD_BRIGHT, EMERALD_DEEP).convert("RGBA")
    img.paste(grad, (0, 0), rounded_mask(s, 0.2237))

    d = ImageDraw.Draw(img)
    # 气泡主体
    pad = s * 0.24
    bubble_h = s * 0.42
    top = (s - bubble_h) / 2 - s * 0.02
    d.rounded_rectangle(
        (pad, top, s - pad, top + bubble_h), radius=bubble_h * 0.30, fill=WHITE
    )
    # 左下角的小尾巴
    tail = [
        (pad + bubble_h * 0.22, top + bubble_h - 1),
        (pad + bubble_h * 0.22, top + bubble_h + s * 0.10),
        (pad + bubble_h * 0.72, top + bubble_h - 1),
    ]
    d.polygon(tail, fill=WHITE)

    # 波形用底色画 —— 视觉上就是抠空
    draw_wave_bars(d, s, bars, EMERALD_DEEP + (255,), width_ratio=0.44)
    return img.resize((size, size), Image.LANCZOS)


VARIANTS = {
    "A1_gap16": lambda s: variant_badge_wave(s, bars=(0.52, 1.0, 0.70)),
    "A2_gap20": lambda s: variant_badge_wave(s, bars=(0.52, 1.0, 0.70), gap_ratio=0.20),
    "A3_gap24": lambda s: variant_badge_wave(s, bars=(0.52, 1.0, 0.70), gap_ratio=0.24),
    "A4_narrow": lambda s: variant_badge_wave(s, bars=(0.52, 1.0, 0.70), width_ratio=0.72, gap_ratio=0.20),
}


def make_toolbar_mockup(fn=None, name="final"):
    """
    真实场景模拟：把图标放到 Chrome 工具栏的浅色/深色底上看。
    这一步才是真正的验收 —— 单看白底缩略图会高估对比度。
    """
    fn = fn or variant_badge_wave
    PREVIEW_DIR.mkdir(exist_ok=True)
    light = (242, 243, 245)
    dark = (32, 33, 36)
    sizes = [128, 48, 32, 16]
    cell = 150
    sheet = Image.new("RGBA", (cell * len(sizes) + 130, 420), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)

    for row, (bg, label) in enumerate(((light, "light toolbar"), (dark, "dark toolbar"))):
        y = row * 200 + 60
        strip = Image.new("RGBA", (cell * len(sizes), 150), bg + (255,))
        sd = ImageDraw.Draw(strip)
        for c, target in enumerate(sizes):
            icon = fn(target)
            x = c * cell + (cell - target) // 2
            strip.alpha_composite(icon, (x, (150 - target) // 2))
            sd.text((c * cell + 8, 150 - 18), f"{target}px", fill=(120, 120, 120))
        sheet.alpha_composite(strip, (130, y - 20))
        d.text((14, y + 40), label, fill=(20, 20, 20))

    out = PREVIEW_DIR / f"toolbar-{name}.png"
    sheet.convert("RGB").save(out)
    print(f"工具栏模拟：{out}")


# --------------------------------------------------------------------- 预览

def checker(size, square=8):
    """透明区域的棋盘底 —— 否则透明部分看不出边界。"""
    img = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    for y in range(0, size, square):
        for x in range(0, size, square):
            if (x // square + y // square) % 2:
                d.rectangle((x, y, x + square - 1, y + square - 1), fill=(226, 232, 240, 255))
    return img


def make_preview():
    """
    对比图：每个方案展示 128 / 48 / 32 / 16 四种尺寸。
    小尺寸放大到 128 用最近邻 —— 这样能真实看到 16px 下"糊成什么样"，
    直接看缩略图会被缩放插值骗过去。
    """
    PREVIEW_DIR.mkdir(exist_ok=True)
    cols = [128, 48, 32, 16]
    cell = 140
    row_h = 190
    sheet = Image.new("RGBA", (cell * len(cols) + 150, row_h * len(VARIANTS)), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)

    for r, (name, fn) in enumerate(VARIANTS.items()):
        y = r * row_h + 20
        d.text((14, y + 50), name, fill=(20, 20, 20))
        for c, target in enumerate(cols):
            large = fn(256)
            small = large.resize((target, target), Image.LANCZOS)
            shown = small.resize((cell - 16, cell - 16), Image.NEAREST)
            x = 150 + c * cell
            bg = checker(cell - 16, 7)
            bg.alpha_composite(shown)
            sheet.alpha_composite(bg, (x, y))
            d.text((x, y + cell + 4), f"{target}px", fill=(90, 90, 90))

    out = PREVIEW_DIR / "variants.png"
    sheet.convert("RGB").save(out)
    print(f"方案对比图：{out}")


def build(size_variants=None):
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    fn = (size_variants or {}).get("fn", variant_badge_wave)
    for s in SIZES:
        fn(s).save(ICON_DIR / f"{s}.png")
        print(f"  public/icon/{s}.png")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "variants"
    if cmd == "variants":
        make_preview()
    elif cmd == "toolbar":
        make_toolbar_mockup()
    elif cmd == "build":
        build()
    else:
        print(__doc__)
