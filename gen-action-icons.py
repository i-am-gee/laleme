#!/usr/bin/env python3
# 生成历史页侧滑操作图标：白色铅笔（修改）、白色垃圾桶（删除）、棕色双箭头（左滑引导）
# 另出白色「分享」图标，供庆祝层与分享按钮使用
# 96x96，4x 超采样；笔画圆头，贴近 iOS SF Symbols 的观感
import os
from PIL import Image, ImageDraw

OUT = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/laleme-miniprogram/assets/actions"
os.makedirs(OUT, exist_ok=True)

SIZE = 96
S = 4
WHITE = (255, 255, 255, 255)
BROWN = (176, 122, 74, 255)  # #B07A4A
CLEAR = (0, 0, 0, 0)


def new_canvas():
    return Image.new("RGBA", (SIZE * S, SIZE * S), CLEAR)


def sc(v):
    return int(round(v * S))


def stroke(d, pts, w, c=WHITE):
    """圆头折线：线宽 + 两端补圆，避免方头切口"""
    d.line([(sc(x), sc(y)) for x, y in pts], fill=c, width=sc(w), joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([sc(x - w / 2.0), sc(y - w / 2.0), sc(x + w / 2.0), sc(y + w / 2.0)], fill=c)


def draw_edit(d, c):
    # 铅笔：笔杆一条粗线 + 独立的笔尾箍 + 一个收尖的三角
    stroke(d, [(37, 63), (58, 42)], 13, c)
    stroke(d, [(62, 38), (67, 33)], 13, c)
    # 笔尖：底边跨在笔杆末端，顶点落在左下
    d.polygon([(sc(31.5), sc(57.5)), (sc(42.5), sc(68.5)), (sc(25), sc(75))], fill=c)
    # 木头与石墨的分界（挖一条细缝）
    d.line([(sc(33.6), sc(60.4)), (sc(38.6), sc(65.4))], fill=CLEAR, width=sc(2.4))


def draw_trash(d, c):
    # 垃圾桶：提手 + 盖 + 桶身 + 两道竖纹
    d.arc([sc(39), sc(13), sc(57), sc(31)], 180, 360, fill=c, width=sc(5))
    stroke(d, [(24, 30), (72, 30)], 5.5, c)
    d.rounded_rectangle([sc(31), sc(41), sc(65), sc(84)], radius=sc(8), outline=c, width=sc(5))
    for x in (42, 54):
        d.line([sc(x), sc(53), sc(x), sc(73)], fill=c, width=sc(4))


def draw_share(d, c):
    # 分享：方框三边 + 一支向外的箭头（iOS square.and.arrow.up）
    d.line(
        [(sc(31), sc(45)), (sc(31), sc(79)), (sc(65), sc(79)), (sc(65), sc(45))],
        fill=c,
        width=sc(6),
        joint="curve",
    )
    for x, y in ((31, 45), (65, 45)):
        d.ellipse([sc(x - 3), sc(y - 3), sc(x + 3), sc(y + 3)], fill=c)
    stroke(d, [(48, 60), (48, 20)], 6, c)
    d.line([(sc(48), sc(20)), (sc(35), sc(33))], fill=c, width=sc(6), joint="curve")
    d.line([(sc(48), sc(20)), (sc(61), sc(33))], fill=c, width=sc(6), joint="curve")


def draw_swipe(d, c):
    # 双箭头（向左），提示可左滑
    for offset in (0, 18):
        x = sc(62 - offset)
        d.line([x, sc(30), x - sc(20), sc(48)], fill=c, width=sc(7))
        d.line([x - sc(20), sc(48), x, sc(66)], fill=c, width=sc(7))


JOBS = (
    ("edit", draw_edit, WHITE, 64),
    ("trash", draw_trash, WHITE, 64),
    ("share-white", draw_share, WHITE, 64),
    ("swipe", draw_swipe, BROWN, 64),
)

for name, fn, color, colors in JOBS:
    img = new_canvas()
    d = ImageDraw.Draw(img)
    fn(d, color)
    img = img.resize((SIZE, SIZE), Image.LANCZOS).quantize(
        colors=colors, method=Image.FASTOCTREE, dither=Image.NONE
    )
    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, name + ".png")))
