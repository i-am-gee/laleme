#!/usr/bin/env python3
# 生成「喊好友挑战」用的分享图标：iOS 风格的方框 + 向上箭头
# 输出两份：share.png（品牌棕，用于浅底）/ share-white.png（纯白，用于实心棕底）
import os
from PIL import Image, ImageDraw

OUT = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/laleme-miniprogram/assets/actions"
os.makedirs(OUT, exist_ok=True)

SIZE = 96
S = 4
CLEAR = (0, 0, 0, 0)
TINT = (139, 94, 60, 255)   # #8B5E3C
WHITE = (255, 255, 255, 255)


def sc(v):
    return int(round(v * S))


def build(color, name):
    img = Image.new("RGBA", (SIZE * S, SIZE * S), CLEAR)
    d = ImageDraw.Draw(img)

    # 方框：底部收纳盒，顶边留出箭头穿过的缺口
    d.rounded_rectangle([sc(20), sc(38), sc(76), sc(86)], radius=sc(12), outline=color, width=sc(7))
    d.rectangle([sc(41), sc(30), sc(55), sc(46)], fill=CLEAR)

    # 箭头：竖杆 + 实心三角头（用多边形避免折线接缝留白）
    d.rectangle([sc(44), sc(24), sc(52), sc(54)], fill=color)
    d.polygon(
        [(sc(48), sc(9)), (sc(27), sc(31)), (sc(34), sc(39)), (sc(48), sc(24)), (sc(62), sc(39)), (sc(69), sc(31))],
        fill=color,
    )

    img = img.resize((SIZE, SIZE), Image.LANCZOS).quantize(
        colors=32, method=Image.FASTOCTREE, dither=Image.NONE
    )
    path = os.path.join(OUT, name)
    img.save(path, optimize=True)
    print(name, os.path.getsize(path))


build(TINT, "share.png")
build(WHITE, "share-white.png")
