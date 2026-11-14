#!/usr/bin/env python3
# 生成首页标题栏「挑战好友」用的分享图标：iOS 风格的方框 + 向上箭头
import os
from PIL import Image, ImageDraw

OUT = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/laleme-miniprogram/assets/actions"
os.makedirs(OUT, exist_ok=True)

SIZE = 96
S = 4
TINT = (139, 94, 60, 255)  # #8B5E3C
CLEAR = (0, 0, 0, 0)


def sc(v):
    return int(round(v * S))


img = Image.new("RGBA", (SIZE * S, SIZE * S), CLEAR)
d = ImageDraw.Draw(img)

# 方框：底部收纳盒，顶边留出箭头穿过的缺口
d.rounded_rectangle([sc(20), sc(38), sc(76), sc(86)], radius=sc(12), outline=TINT, width=sc(7))
d.rectangle([sc(41), sc(30), sc(55), sc(46)], fill=CLEAR)

# 箭头：竖杆 + 实心三角头（用多边形避免折线接缝留白）
d.rectangle([sc(44), sc(24), sc(52), sc(54)], fill=TINT)
d.polygon(
    [(sc(48), sc(9)), (sc(27), sc(31)), (sc(34), sc(39)), (sc(48), sc(24)), (sc(62), sc(39)), (sc(69), sc(31))],
    fill=TINT,
)

img = img.resize((SIZE, SIZE), Image.LANCZOS).quantize(
    colors=32, method=Image.FASTOCTREE, dither=Image.NONE
)
path = os.path.join(OUT, "share.png")
img.save(path, optimize=True)
print("share", os.path.getsize(path))
