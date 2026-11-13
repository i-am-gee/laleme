#!/usr/bin/env python3
# 生成「拉了么」成就徽章图标：96x96 PNG，同色系棕色
# 点亮：实心棕底 + 米色图形；未点亮：浅米底 + 浅棕描边图形
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/laleme-miniprogram/assets/badges"
os.makedirs(OUT, exist_ok=True)

SIZE = 96
S = 4  # 超采样

LIT_BG = (139, 94, 60, 255)      # #8B5E3C
LIT_FG = (250, 238, 218, 255)    # #FAEEDA
OFF_BG = (243, 239, 232, 255)    # #F3EFE8
OFF_FG = (198, 181, 160, 255)    # #C6B5A0


def new_canvas():
    return Image.new("RGBA", (SIZE * S, SIZE * S), (0, 0, 0, 0))


def sc(v):
    return int(round(v * S))


def draw_week(d, c):
    # 七日全勤：一圈 7 个圆点
    import math
    cx, cy, r = sc(48), sc(48), sc(21)
    for i in range(7):
        a = math.radians(-90 + i * (360 / 7))
        px, py = cx + r * math.cos(a), cy + r * math.sin(a)
        rr = sc(5.2)
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=c)


def draw_flash(d, c):
    # 闪电侠：闪电折线
    pts = [(sc(55), sc(20)), (sc(33), sc(52)), (sc(46), sc(52)),
           (sc(41), sc(77)), (sc(64), sc(43)), (sc(50), sc(43))]
    d.polygon(pts, fill=c)


def draw_marathon(d, c):
    # 马拉松：秒表（外圈 + 指针 + 顶钮）
    d.ellipse([sc(30), sc(31), sc(66), sc(67)], outline=c, width=sc(5))
    d.line([sc(48), sc(49), sc(48), sc(39)], fill=c, width=sc(4.5))
    d.line([sc(48), sc(49), sc(57), sc(55)], fill=c, width=sc(4.5))
    d.rounded_rectangle([sc(42), sc(20), sc(54), sc(26)], radius=sc(3), fill=c)
    d.line([sc(48), sc(26), sc(48), sc(31)], fill=c, width=sc(4))


def draw_collector(d, c):
    # 收藏家：一个罐子 + 里面装满的小块（集齐 1-7 型）
    d.rounded_rectangle([sc(31), sc(36), sc(65), sc(74)], radius=sc(9), outline=c, width=sc(4.6))
    d.rounded_rectangle([sc(27), sc(29), sc(69), sc(37)], radius=sc(3.5), fill=c)
    for cx, cy in ((sc(41), sc(58)), (sc(55), sc(58)), (sc(48), sc(67))):
        rr = sc(4.4)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=c)


GLYPHS = {
    "week": draw_week,
    "flash": draw_flash,
    "marathon": draw_marathon,
    "collector": draw_collector,
}


def build(name, glyph, lit):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    bg = LIT_BG if lit else OFF_BG
    fg = LIT_FG if lit else OFF_FG
    # 底盘：正圆
    d.ellipse([sc(4), sc(4), sc(92), sc(92)], fill=bg)
    # 内圈细描边，做出奖章的层次
    ring = (107, 72, 48, 120) if lit else (224, 211, 194, 255)
    d.ellipse([sc(11), sc(11), sc(85), sc(85)], outline=ring, width=sc(1.6))
    glyph(d, fg)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    # 平面色图标量化到 64 色，体积从 ~9KB 降到 ~2KB，视觉无差异
    img = img.quantize(colors=64, method=Image.FASTOCTREE, dither=Image.NONE)
    suffix = "on" if lit else "off"
    img.save(os.path.join(OUT, "%s-%s.png" % (name, suffix)), optimize=True)
    return img


for key, fn in GLYPHS.items():
    on = build(key, fn, True)
    build(key, fn, False)

# 拼一张预览图（4 列 x 2 行）
prev = Image.new("RGB", (SIZE * 4 + 40, SIZE * 2 + 30), (255, 252, 246))
for i, key in enumerate(GLYPHS):
    prev.paste(Image.open(os.path.join(OUT, "%s-on.png" % key)), (10 + i * (SIZE + 10), 10), Image.open(os.path.join(OUT, "%s-on.png" % key)))
    prev.paste(Image.open(os.path.join(OUT, "%s-off.png" % key)), (10 + i * (SIZE + 10), 20 + SIZE), Image.open(os.path.join(OUT, "%s-off.png" % key)))
prev.save("/tmp/badges-preview.png")
print("done", len(os.listdir(OUT)))
