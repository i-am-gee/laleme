#!/usr/bin/env python3
# 生成「拉了么」记录表单用的形状与感受图标
# 7 型布里斯托形状 + 3 种感受，单色棕剪影，96x96，4x 超采样
# 选中态交给容器（背景/描边）表达，图标本身只出一套
import os
from PIL import Image, ImageDraw

OUT = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/laleme-miniprogram/assets/bristol"
os.makedirs(OUT, exist_ok=True)

SIZE = 96
S = 4
INK = (122, 82, 48, 255)      # #7A5230，比品牌棕深一档，压在白底上更清楚
CLEAR = (0, 0, 0, 0)


def sc(v):
    return int(round(v * S))


def canvas():
    return Image.new("RGBA", (SIZE * S, SIZE * S), CLEAR)


def circle(d, cx, cy, r, fill=INK):
    d.ellipse([sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)], fill=fill)


def save(img, name):
    img.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, name))


# ---------- 1 型：一颗颗独立的硬球 ----------
def t1():
    im = canvas()
    d = ImageDraw.Draw(im)
    circle(d, 34, 40, 12)
    circle(d, 58, 38, 11)
    circle(d, 48, 62, 11.5)
    save(im, "t1.png")


# ---------- 2 型：连成一串的硬块，表面凹凸 ----------
def t2():
    im = canvas()
    d = ImageDraw.Draw(im)
    for cx in (31, 44, 57, 67):
        circle(d, cx, 51, 12)
    save(im, "t2.png")


# ---------- 3 型：香肠状，表面有裂纹 ----------
def t3():
    im = canvas()
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([sc(24), sc(38), sc(72), sc(64)], radius=sc(13), fill=INK)
    # 用透明色把裂纹「擦」出来：三条从顶部贯通到底部的折线
    for pts in (
        [(34, 38), (37, 48), (33, 58), (36, 64)],
        [(48, 38), (45, 49), (49, 57), (46, 64)],
        [(62, 38), (59, 48), (63, 57), (60, 64)],
    ):
        d.line([(sc(x), sc(y)) for x, y in pts], fill=CLEAR, width=sc(2.6), joint="curve")
    save(im, "t3.png")


# ---------- 4 型：光滑柔软，略呈弯曲的香肠 ----------
def t4():
    im = canvas()
    d = ImageDraw.Draw(im)
    import math
    for x in range(30, 68):
        y = 52 + 9 * math.sin((x - 30) / 19.0)
        r = 12.2 if 34 <= x <= 64 else 11
        circle(d, x, y, r)
    save(im, "t4.png")


# ---------- 5 型：几块柔软团块，边缘清晰 ----------
def t5():
    im = canvas()
    d = ImageDraw.Draw(im)
    # 两块明显不同的团，光滑边缘、彼此融合（与 1 型的独立硬球、6 型的毛边区分开）
    circle(d, 42, 56, 16)
    circle(d, 60, 45, 12)
    save(im, "t5.png")


# ---------- 6 型：糊状，边缘蓬松毛糙 ----------
def t6():
    im = canvas()
    d = ImageDraw.Draw(im)
    import math
    # 主体
    for cx, cy, r in ((42, 52, 14), (54, 48, 13), (48, 60, 12), (58, 58, 10), (36, 46, 10)):
        circle(d, cx, cy, r)
    # 一圈小凸起，做出毛边
    for i in range(14):
        a = math.radians(i * (360 / 14))
        cx = 48 + 17 * math.cos(a)
        cy = 53 + 13 * math.sin(a)
        circle(d, cx, cy, 4.2)
    save(im, "t6.png")


# ---------- 7 型：水状，一滩加溅点 ----------
def t7():
    im = canvas()
    d = ImageDraw.Draw(im)
    d.ellipse([sc(26), sc(52), sc(70), sc(66)], fill=INK)
    d.ellipse([sc(46), sc(56), sc(74), sc(68)], fill=INK)
    for cx, cy, r in ((30, 44, 4), (66, 44, 3.4), (52, 40, 3), (38, 70, 3.2), (64, 72, 2.8)):
        circle(d, cx, cy, r)
    save(im, "t7.png")


# ---------- 感受：三种表情 ----------
def face(name, kind):
    im = canvas()
    d = ImageDraw.Draw(im)
    d.ellipse([sc(24), sc(24), sc(72), sc(72)], outline=INK, width=sc(5))
    circle(d, 39, 44, 3.4)
    circle(d, 57, 44, 3.4)
    if kind == "good":
        d.arc([sc(36), sc(44), sc(60), sc(64)], 15, 165, fill=INK, width=sc(4.4))
    elif kind == "normal":
        d.line([sc(38), sc(56), sc(58), sc(56)], fill=INK, width=sc(4.4))
    else:
        d.arc([sc(36), sc(50), sc(60), sc(70)], 195, 345, fill=INK, width=sc(4.4))
    save(im, name)


if __name__ == "__main__":
    t1(); t2(); t3(); t4(); t5(); t6(); t7()
    face("m-good.png", "good")
    face("m-normal.png", "normal")
    face("m-hard.png", "hard")
    print("done", sorted(os.listdir(OUT)))
