// 分享公共模块：5:4 分享卡片海报绘制（适配微信缩略图，不裁切）+ 三页统一分享内容
// 海报内容 = 品牌名 + 口号 + 本月日历（图形化打卡记录）+ 已点亮徽章
// 缓存于模块级变量：同统计数据只绘制一次，index/stats/me 共用

const { SHARE_TITLES, BADGES, monthCalendar, streakDays, achievements } = require('./constants.js');

let cachedPath = '';
let cachedKey = '';
const POSTER_VERSION = 3; // 视觉改版时递增，避免复用旧海报缓存

// 分享用的统计数据：一次算好，三页共用
function makeStats(records) {
    const list = records || [];
    const calendar = monthCalendar(list);
    const got = achievements(list);
    return {
        streak: streakDays(list),
        monthDays: calendar.activeDays,
        calendar: calendar,
        badges: BADGES.map(function (b) {
            return { id: b.id, on: !!got[b.id] };
        }),
    };
}

function posterKey(stats) {
    const s = stats || {};
    const badges = (s.badges || []).map(function (b) { return b.on ? '1' : '0'; }).join('');
    return [
        POSTER_VERSION,
        s.streak || 0,
        s.monthDays || 0,
        (s.calendar && s.calendar.today) || 0,
        badges,
    ].join('|');
}

function makeTitle(streak, month) {
    if (streak <= 0 && month <= 0) {
        return '拉了么？来记录你的肠道健康💩';
    }
    const tpl = SHARE_TITLES[Math.floor(Math.random() * SHARE_TITLES.length)];
    return tpl.replace('{s}', String(streak)).replace('{m}', String(month));
}

// 统一的分享信息：任何页面发出，好友看到的都是同一张卡片（标题 + 挑战落地页 + 海报图）
function makeShareInfo(stats) {
    const streak = (stats && stats.streak) || 0;
    const month = (stats && stats.monthDays) || 0;
    const info = {
        title: makeTitle(streak, month),
        path: '/pages/index/index?challenge=1&streak=' + streak + '&month=' + month,
    };
    if (cachedPath) {
        info.imageUrl = cachedPath;
    }
    return info;
}

// ---------------- 分享计数与「大屎官」称号 ----------------
// 按「拉起分享的次数」计数（微信不回调发送结果，只能以拉起为准），满 3 次发称号
const SHARE_COUNT_KEY = 'laleme_share_count';
const SHARE_BADGE_KEY = 'laleme_share_badge';
const SHARE_BADGE_TARGET = 3;

function shareCount() {
    const n = parseInt(wx.getStorageSync(SHARE_COUNT_KEY), 10);
    return isNaN(n) || n < 0 ? 0 : n;
}

function shareBadge() {
    return wx.getStorageSync(SHARE_BADGE_KEY) === 1;
}

// 每次拉起分享调用一次；返回本次之后的进度，earned 标记是否「刚好达成」
// 达成时留一个时间戳，首页 onShow 读到就放庆祝（分享面板正盖着，当场看不见）
function trackShare() {
    if (shareBadge()) {
        return { count: shareCount(), earned: false, badge: true };
    }
    const next = shareCount() + 1;
    wx.setStorageSync(SHARE_COUNT_KEY, next);
    if (next >= SHARE_BADGE_TARGET) {
        wx.setStorageSync(SHARE_BADGE_KEY, 1);
        wx.setStorageSync('laleme_badge_flag', Date.now());
        return { count: next, earned: true, badge: true };
    }
    return { count: next, earned: false, badge: false };
}

// 导出备份时带上，导入时再写回，保证「整份数据」可迁移
function shareMeta() {
    return { shareCount: shareCount(), shareBadge: shareBadge() };
}

function setShareState(count, badge) {
    const n = Math.max(0, Math.min(parseInt(count, 10) || 0, 99));
    if (n > 0) {
        wx.setStorageSync(SHARE_COUNT_KEY, n);
    } else {
        wx.removeStorageSync(SHARE_COUNT_KEY);
    }
    if (badge) {
        wx.setStorageSync(SHARE_BADGE_KEY, 1);
    } else {
        wx.removeStorageSync(SHARE_BADGE_KEY);
    }
}

// 清空全部数据时一并抹掉分享进度与称号
function clearShareState() {
    wx.removeStorageSync(SHARE_COUNT_KEY);
    wx.removeStorageSync(SHARE_BADGE_KEY);
}

// 页面 onReady/数据就绪后调用；页面需含 <canvas type="2d" id="shareCanvas"/>
function ensurePoster(page, stats) {
    const key = posterKey(stats);
    if (cachedPath && cachedKey === key) {
        return;
    }
    wx.createSelectorQuery()
        .in(page)
        .select('#shareCanvas')
        .fields({ node: true, size: true })
        .exec(function (res) {
            if (!res || !res[0] || !res[0].node) {
                return; // 画布未就绪，等下一次 onShow 重试
            }
            drawPoster(res[0].node, stats, function (path) {
                cachedPath = path;
                cachedKey = key;
            });
        });
}

function getPosterPath() {
    return cachedPath;
}

/* ---------------- 海报绘制 ---------------- */

const W = 500;
const H = 400; // 5:4，与微信分享卡片缩略图比例一致，完整展示不裁切
const BROWN = '#8B5E3C';
const CREAM = '#FAEEDA';
const SOFT = '#D9BFA6';
const DEEP = '#7A5230';

// 预加载徽章图标（canvas 2d 必须走 canvas.createImage）
function loadBadgeImages(canvas, badges, done) {
    const list = badges || [];
    if (!list.length) {
        done({});
        return;
    }
    const images = {};
    let pending = list.length;
    let finished = false;

    function settle() {
        pending -= 1;
        if (pending <= 0 && !finished) {
            finished = true;
            done(images);
        }
    }

    list.forEach(function (b) {
        const meta = BADGES.filter(function (x) { return x.id === b.id; })[0];
        if (!meta) {
            settle();
            return;
        }
        const img = canvas.createImage();
        img.onload = function () {
            images[b.id] = img;
            settle();
        };
        img.onerror = function () {
            settle();
        };
        img.src = b.on ? meta.iconOn : meta.iconOff;
    });

    // 兜底：1.2s 内没加载完也照常出图（缺的徽章跳过，用降级圆点）
    setTimeout(function () {
        if (!finished) {
            finished = true;
            done(images);
        }
    }, 1200);
}

function drawPoster(canvas, stats, done) {
    loadBadgeImages(canvas, (stats && stats.badges) || [], function (images) {
        paint(canvas, stats, images);
        wx.canvasToTempFilePath({
            canvas: canvas,
            destWidth: W,
            destHeight: H,
            success: function (r) {
                done(r.tempFilePath);
            },
            fail: function () {
                // 海报失败不影响分享（回退为默认截图）
            },
        });
    });
}

function paint(canvas, stats, images) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min((wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2, 3);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = BROWN;
    ctx.fillRect(0, 0, W, 8);
    ctx.fillRect(0, H - 8, W, 8);

    // ---- 品牌区 ----
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = BROWN;
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText('拉了么', 30, 62);
    ctx.fillStyle = DEEP;
    ctx.font = '600 17px sans-serif';
    ctx.fillText('记录每一次，读懂你的肠道', 31, 88);
    ctx.fillStyle = SOFT;
    ctx.fillRect(31, 98, 46, 4);

    // ---- 本月日历（图形化打卡记录）----
    drawCalendar(ctx, stats && stats.calendar);

    // ---- 右侧：徽章 + 品牌符号 ----
    drawBadges(ctx, (stats && stats.badges) || [], images);

    ctx.textAlign = 'center';
    ctx.font = '88px sans-serif';
    ctx.fillText('💩', 392, 372);
}

function drawCalendar(ctx, calendar) {
    if (!calendar) {
        return;
    }
    const x0 = 26;
    const cell = 32;
    const gap = 5;
    const step = cell + gap;
    const startY = 172;
    const rowStep = 34;

    // 月份
    ctx.textAlign = 'left';
    ctx.fillStyle = BROWN;
    ctx.font = '600 17px sans-serif';
    ctx.fillText(calendar.monthLabel, x0, 138);

    // 星期表头（周一开始）
    const weeks = ['一', '二', '三', '四', '五', '六', '日'];
    ctx.textAlign = 'center';
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#B08D6A';
    weeks.forEach(function (w, i) {
        ctx.fillText(w, x0 + i * step + cell / 2, 160);
    });

    const cells = calendar.cells || [];
    cells.forEach(function (c, index) {
        if (c.blank) {
            return;
        }
        const col = index % 7;
        const row = Math.floor(index / 7);
        const x = x0 + col * step;
        const y = startY + row * rowStep;
        const filled = c.count > 0;

        if (filled) {
            ctx.fillStyle = BROWN;
            roundRect(ctx, x, y, cell, cell, 9);
            ctx.fill();
        } else if (c.today) {
            ctx.strokeStyle = BROWN;
            ctx.lineWidth = 2;
            roundRect(ctx, x + 1, y + 1, cell - 2, cell - 2, 8);
            ctx.stroke();
        }

        ctx.font = (filled ? 'bold 13px' : '12px') + ' sans-serif';
        if (filled) {
            ctx.fillStyle = CREAM;
        } else if (c.future) {
            ctx.fillStyle = '#DCC9AE';
        } else {
            ctx.fillStyle = '#C0A588';
        }
        ctx.fillText(String(c.day), x + cell / 2, y + cell / 2 + 4);

        // 两次及以上：右上角小角标
        if (c.count > 1) {
            ctx.beginPath();
            ctx.arc(x + cell - 3, y + 3, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#F0B27A';
            ctx.fill();
        }
    });
}

function drawBadges(ctx, badges, images) {
    const size = 62;
    const gapX = 10;
    const gapY = 10;
    const x0 = 325;
    const y0 = 132;
    badges.forEach(function (b, i) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = x0 + col * (size + gapX);
        const y = y0 + row * (size + gapY);
        const img = images && images[b.id];
        if (img) {
            ctx.save();
            if (!b.on) {
                ctx.globalAlpha = 0.3;
            }
            ctx.drawImage(img, x, y, size, size);
            ctx.restore();
        } else {
            // 图标未就绪时的降级：同色系圆点
            ctx.beginPath();
            ctx.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2);
            ctx.fillStyle = b.on ? BROWN : '#EFE4D2';
            ctx.fill();
        }
    });
}

// 圆角矩形路径
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

module.exports = {
    makeStats: makeStats,
    makeShareInfo: makeShareInfo,
    ensurePoster: ensurePoster,
    getPosterPath: getPosterPath,
    shareCount: shareCount,
    shareBadge: shareBadge,
    trackShare: trackShare,
    shareMeta: shareMeta,
    setShareState: setShareState,
    clearShareState: clearShareState,
    SHARE_BADGE_TARGET: SHARE_BADGE_TARGET,
};
