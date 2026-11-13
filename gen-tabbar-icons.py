#!/usr/bin/env python3
# 生成「拉了么」tabBar 图标：81x81 PNG，选中 #8B5E3C / 未选 #B9B0A2
import os
from PIL import Image, ImageDraw

OUT = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/laleme-miniprogram/assets/tabbar"
os.makedirs(OUT, exist_ok=True)

SIZE = 81
S = 4  # 超采样抗锯齿
SELECTED = (139, 94, 60, 255)     # #8B5E3C
UNSELECTED = (185, 176, 162, 255) # #B9B0A2

def canvas():
    return Image.new("RGBA", (SIZE * S, SIZE * S), (0, 0, 0, 0))

def s(v):
    return v * S

def draw_home(d, c):
    # 便便：三层堆叠 + 顶端小尖
    for box in [((s(13), s(47)), (s(68), s(67))),
                ((s(19), s(31)), (s(62), s(52))),
                ((s(26), s(17)), (s(55), s(36)))]:
        d.ellipse([box[0][0], box[0][1], box[1][0], box[1][1]], fill=c)
    d.ellipse([s(33), s(9), s(47), s(23)], fill=c)

def draw_history(d, c):
    # 日历：圆角外框 + 顶部双钉 + 内部分隔线
    d.rounded_rectangle([s(17), s(20), s(64), s(66)], radius=s(6), outline=c, width=s(5))
    d.rounded_rectangle([s(26), s(12), s(32), s(26)], radius=s(3), fill=c)
    d.rounded_rectangle([s(49), s(12), s(55), s(26)], radius=s(3), fill=c)
    d.line([s(22), s(35), s(59), s(35)], fill=c, width=s(5))
    # 里面一颗小便便标记
    d.ellipse([s(36), s(44), s(45), s(51)], fill=c)

def draw_stats(d, c):
    # 三根圆角柱
    for box in [((s(16), s(42)), (s(28), s(64))),
                ((s(34), s(30)), (s(46), s(64))),
                ((s(52), s(18)), (s(64), s(64)))]:
        d.rounded_rectangle([box[0][0], box[0][1], box[1][0], box[1][1]], radius=s(4), fill=c)

def draw_me(d, c):
    # 人形：圆头 + 肩部
    d.ellipse([s(29), s(13), s(52), s(36)], fill=c)
    d.ellipse([s(18), s(44), s(63), s(68)], fill=c)

ICONS = {
    "home": draw_home,
    "history": draw_history,
    "stats": draw_stats,
    "me": draw_me,
}

for name, fn in ICONS.items():
    for suffix, color in [("", UNSELECTED), ("-active", SELECTED)]:
        im = canvas()
        d = ImageDraw.Draw(im)
        fn(d, color)
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        path = os.path.join(OUT, f"{name}{suffix}.png")
        im.save(path)
        print("saved", path, os.path.getsize(path), "bytes")
