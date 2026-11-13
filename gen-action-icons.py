#!/usr/bin/env python3
# 生成历史页左滑操作图标：白色铅笔（修改）、白色垃圾桶（删除）、棕色双箭头（左滑引导）
import os
from PIL import Image, ImageDraw

OUT = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/laleme-miniprogram/assets/actions"
os.makedirs(OUT, exist_ok=True)

SIZE = 96
S = 4
WHITE = (255, 255, 255, 255)
BROWN = (176, 122, 74, 255)  # #B07A4A


def new_canvas():
    return Image.new("RGBA", (SIZE * S, SIZE * S), (0, 0, 0, 0))


def sc(v):
    return int(round(v * S))


def draw_edit(d, c):
    # 铅笔：笔杆（斜置矩形）+ 笔尖三角 + 尾部橡皮线
    body = [(sc(26), sc(70)), (sc(62), sc(34)), (sc(74), sc(46)), (sc(38), sc(82))]
    d.polygon(body, fill=c)
    tip = [(sc(26), sc(70)), (sc(38), sc(82)), (sc(20), sc(88))]
    d.polygon(tip, fill=c)
    # 笔杆分界线
    d.line([sc(56), sc(40), sc(68), sc(52)], fill=(0, 0, 0, 0), width=sc(2))


def draw_trash(d, c):
    # 垃圾桶：盖 + 提手 + 桶身 + 两道竖线
    d.rounded_rectangle([sc(24), sc(28), sc(72), sc(36)], radius=sc(4), fill=c)
    d.rounded_rectangle([sc(40), sc(18), sc(56), sc(26)], radius=sc(3), fill=c)
    d.rounded_rectangle([sc(30), sc(40), sc(66), sc(84)], radius=sc(7), outline=c, width=sc(5))
    for x in (sc(42), sc(54)):
        d.line([x, sc(52), x, sc(72)], fill=c, width=sc(4))


def draw_swipe(d, c):
    # 双箭头（向左），提示可左滑
    for offset in (0, 18):
        x = sc(62 - offset)
        d.line([x, sc(30), x - sc(20), sc(48)], fill=c, width=sc(7))
        d.line([x - sc(20), sc(48), x, sc(66)], fill=c, width=sc(7))


for name, fn, color in (
    ("edit", draw_edit, WHITE),
    ("trash", draw_trash, WHITE),
    ("swipe", draw_swipe, BROWN),
):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    fn(d, color)
    img = img.resize((SIZE, SIZE), Image.LANCZOS).quantize(
        colors=64, method=Image.FASTOCTREE, dither=Image.NONE
    )
    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, name + ".png")))
