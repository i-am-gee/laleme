#!/usr/bin/env python3
# 生成「拉了么」段位便便图标：未定级 + 7 个段位，越往后装饰越多、越"贵"
# 160x160 PNG，4x 超采样；统一奶白描边，保证压在品牌棕的大按钮上也看得清
import os
import math
from PIL import Image, ImageDraw

OUT = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/laleme-miniprogram/assets/rank"
os.makedirs(OUT, exist_ok=True)

SIZE = 160
S = 4
W = SIZE * S
RIM = (252, 246, 238, 255)  # 奶白描边

PALETTE = {
    "none":     dict(top=(216, 196, 172), bottom=(158, 124, 94), ink=(122, 92, 68), shine=(255, 255, 255, 175)),
    "bronze":   dict(top=(206, 158, 118), bottom=(128, 84, 52), ink=(112, 71, 43), shine=(255, 246, 236, 190)),
    "silver":   dict(top=(233, 237, 240), bottom=(150, 156, 163), ink=(133, 139, 146), shine=(255, 255, 255, 235)),
    "gold":     dict(top=(246, 214, 140), bottom=(172, 121, 40), ink=(155, 108, 33), shine=(255, 250, 226, 240)),
    "platinum": dict(top=(242, 247, 248), bottom=(158, 172, 178), ink=(141, 155, 162), shine=(255, 255, 255, 240)),
    "diamond":  dict(top=(223, 244, 253), bottom=(124, 180, 208), ink=(108, 163, 190), shine=(255, 255, 255, 245)),
    "star":     dict(top=(215, 196, 246), bottom=(133, 104, 194), ink=(118, 90, 176), shine=(255, 250, 231, 240)),
    "king":     dict(top=(250, 226, 168), bottom=(186, 133, 40), ink=(165, 116, 31), shine=(255, 252, 235, 245)),
}


def sc(v):
    return int(round(v * S))


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def poop(d, grow, fill):
    """三层堆叠 + 顶端小尖；grow 用来画外描边（整体放大几像素）"""
    g = grow
    d.ellipse([sc(22 - g), sc(96 - g), sc(138 + g), sc(142 + g)], fill=fill)
    d.ellipse([sc(34 - g), sc(66 - g), sc(126 + g), sc(114 + g)], fill=fill)
    d.ellipse([sc(46 - g), sc(42 - g), sc(114 + g), sc(86 + g)], fill=fill)
    d.ellipse([sc(64 - g), sc(26 - g), sc(96 + g), sc(56 + g)], fill=fill)


def gradient(top, bottom):
    """竖向渐变：顶部亮、底部沉，比纯色更有体块感"""
    g = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    for y in range(W):
        t = y / (W - 1)
        # 上三分之一提亮，下三分之一压深，中段接近原色
        if t < 0.34:
            c = lerp(top, bottom, t / 0.34 * 0.42)
        else:
            c = lerp(lerp(top, bottom, 0.42), bottom, (t - 0.34) / 0.66)
        gd.line([(0, y), (W, y)], fill=(c[0], c[1], c[2], 255))
    return g


def base_icon(key):
    p = PALETTE[key]
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    # 1) 奶白描边：整体放大一圈，压在深色底上也能分辨
    edge = ImageDraw.Draw(im)
    poop(edge, 3.4, RIM)
    # 2) 主体：渐变穿过剪影蒙版
    mask = Image.new("L", (W, W), 0)
    poop(ImageDraw.Draw(mask), 0, 255)
    body = gradient(p["top"], p["bottom"])
    im.paste(body, (0, 0), mask)
    return im, ImageDraw.Draw(im)


def sparkle(d, cx, cy, r, fill):
    d.polygon(
        [
            (sc(cx), sc(cy - r)),
            (sc(cx + r * 0.28), sc(cy - r * 0.28)),
            (sc(cx + r), sc(cy)),
            (sc(cx + r * 0.28), sc(cy + r * 0.28)),
            (sc(cx), sc(cy + r)),
            (sc(cx - r * 0.28), sc(cy + r * 0.28)),
            (sc(cx - r), sc(cy)),
            (sc(cx - r * 0.28), sc(cy - r * 0.28)),
        ],
        fill=fill,
    )


def star5(d, cx, cy, r, fill):
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.44
        pts.append((sc(cx + math.cos(ang) * rr), sc(cy + math.sin(ang) * rr)))
    d.polygon(pts, fill=fill)


def ring(d, cx, cy, rx, ry, color, w):
    d.ellipse([sc(cx - rx), sc(cy - ry), sc(cx + rx), sc(cy + ry)], outline=color, width=sc(w))


def shine(d, p):
    """左上一条弧形高光，所有段位共用，统一体块语言"""
    d.arc(
        [sc(50), sc(40), sc(96), sc(82)],
        start=196,
        end=268,
        fill=p["shine"],
        width=sc(4.2),
    )


# ---------- 未定级：朴素，无装饰 ----------
def icon_none():
    p = PALETTE["none"]
    im, d = base_icon("none")
    shine(d, p)
    return im


# ---------- 青铜：两颗铆钉 + 底座压边 ----------
def icon_bronze():
    p = PALETTE["bronze"]
    im, d = base_icon("bronze")
    shine(d, p)
    ring(d, 80, 132, 50, 10, p["ink"], 2.6)
    return im


# ---------- 白银：底座细环 + 更亮的镜面 ----------
def icon_silver():
    p = PALETTE["silver"]
    im, d = base_icon("silver")
    shine(d, p)
    ring(d, 80, 132, 50, 10, p["ink"], 3)
    d.arc([sc(52), sc(98), sc(110), sc(132)], start=196, end=268, fill=(255, 255, 255, 200), width=sc(3.4))
    return im


# ---------- 黄金：三颗四角星 ----------
def icon_gold():
    p = PALETTE["gold"]
    im, d = base_icon("gold")
    shine(d, p)
    sparkle(d, 120, 54, 13, (255, 250, 222, 255))
    sparkle(d, 38, 92, 9, (255, 250, 222, 235))
    sparkle(d, 116, 108, 6.5, (255, 250, 222, 215))
    return im


# ---------- 铂金：底座双环 + 顶部亮冠 ----------
def icon_platinum():
    p = PALETTE["platinum"]
    im, d = base_icon("platinum")
    shine(d, p)
    ring(d, 80, 132, 52, 11, p["ink"], 3.2)
    ring(d, 80, 132, 42, 8, (255, 255, 255, 220), 2.4)
    d.arc([sc(50), sc(40), sc(98), sc(84)], start=198, end=266, fill=(255, 255, 255, 240), width=sc(4.6))
    return im


# ---------- 钻石：切面棱线 + 高光闪 ----------
def icon_diamond():
    p = PALETTE["diamond"]
    im, d = base_icon("diamond")
    shine(d, p)
    # 切面：底块内部两刀白色棱线，收在剪影里，像水晶的剖切面
    d.line([(sc(62), sc(116)), (sc(84), sc(104))], fill=(255, 255, 255, 205), width=sc(2.2))
    d.line([(sc(84), sc(104)), (sc(104), sc(122))], fill=(255, 255, 255, 205), width=sc(2.2))
    d.line([(sc(84), sc(104)), (sc(78), sc(136))], fill=(255, 255, 255, 140), width=sc(1.8))
    sparkle(d, 124, 44, 13, (255, 255, 255, 250))
    sparkle(d, 34, 84, 7, (255, 255, 255, 200))
    return im


# ---------- 星耀：环绕星轨 + 两颗星 ----------
def icon_star():
    p = PALETTE["star"]
    im, d = base_icon("star")
    shine(d, p)
    ring(d, 80, 96, 70, 24, (255, 252, 235, 130), 3)
    star5(d, 128, 56, 12, (255, 250, 224, 255))
    star5(d, 38, 62, 8, (255, 250, 224, 220))
    return im


# ---------- 王者：皇冠 + 光点 + 底座金环 ----------
def icon_king():
    p = PALETTE["king"]
    im, d = base_icon("king")
    shine(d, p)
    crown = [(52, 24), (62, 38), (72, 20), (80, 38), (88, 20), (98, 38), (108, 24), (104, 44), (56, 44)]
    d.polygon([(sc(x), sc(y)) for x, y in crown], fill=(250, 228, 168, 255))
    d.line([(sc(x), sc(y)) for x, y in crown] + [(sc(52), sc(24))], fill=(165, 116, 31, 255), width=sc(2))
    d.ellipse([sc(75), sc(30), sc(85), sc(40)], fill=(226, 179, 74, 255))
    for cx, cy, r, a in ((28, 46, 4, 200), (132, 72, 5, 180), (24, 116, 3.4, 160), (136, 118, 3.4, 160)):
        d.ellipse([sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)], fill=(255, 250, 226, a))
    ring(d, 80, 132, 52, 11, p["ink"], 3)
    return im


BUILDERS = {
    "none": icon_none,
    "bronze": icon_bronze,
    "silver": icon_silver,
    "gold": icon_gold,
    "platinum": icon_platinum,
    "diamond": icon_diamond,
    "star": icon_star,
    "king": icon_king,
}

for key, fn in BUILDERS.items():
    img = fn().resize((SIZE, SIZE), Image.LANCZOS)
    path = os.path.join(OUT, key + ".png")
    img.save(path)
    print(key, os.path.getsize(path))
