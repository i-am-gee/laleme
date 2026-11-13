// 分享公共模块：5:4 分享卡片海报绘制（适配微信缩略图，不裁切）+ 三页统一分享内容
// 海报缓存于模块级变量：同统计数据只绘制一次，index/stats/me 共用
const { SHARE_TITLES } = require('./constants.js');

let cachedPath = '';
let cachedKey = '';
const POSTER_VERSION = 2; // 视觉改版时递增，避免复用旧海报缓存

function posterKey(stats) {
    return POSTER_VERSION + '|' + (stats.streak || 0) + '|' + (stats.monthDays || 0);
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

function drawPoster(canvas, stats, done) {
    const ctx = canvas.getContext('2d');
    const W = 500;
    const H = 400; // 5:4，与微信分享卡片缩略图比例一致，完整展示不裁切
    const dpr = Math.min(
        (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2,
        3
    );
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#FAEEDA';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8B5E3C';
    ctx.fillRect(0, 0, W, 8);
    ctx.fillRect(0, H - 8, W, 8);

    // ---- 品牌区（左上）：只出现标题里没有的内容 ----
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8B5E3C';
    ctx.font = 'bold 62px sans-serif';
    ctx.fillText('拉了么', 38, 92);
    ctx.fillStyle = '#7A5230';
    ctx.font = '600 26px sans-serif';
    ctx.fillText('记录每一次，读懂你的肠道', 40, 130);
    // 品牌短横线
    ctx.fillStyle = '#D9BFA6';
    ctx.fillRect(40, 148, 58, 5);

    // ---- 图形化信息（不重复标题中的天数文字）----
    const streak = Math.min((stats && stats.streak) || 0, 14);
    const month = Math.min((stats && stats.monthDays) || 0, 28);
    const SOLID = '#8B5E3C';
    const HOLLOW = '#D9BFA6';

    // 1) 连续打卡：一排圆点，实心=已打卡（最多 14 天）
    const dotR = 6;
    const dotGap = 19;
    for (let i = 0; i < 14; i += 1) {
        const cx = 46 + i * dotGap;
        const cy = 206;
        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        if (i < streak) {
            ctx.fillStyle = SOLID;
            ctx.fill();
        } else {
            ctx.strokeStyle = HOLLOW;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // 2) 本月打卡：7×4 方块网格，实心=已打卡
    const cellSize = 16;
    const cellGap = 8;
    for (let i = 0; i < 28; i += 1) {
        const col = i % 7;
        const row = Math.floor(i / 7);
        const x = 40 + col * (cellSize + cellGap);
        const y = 246 + row * (cellSize + cellGap);
        if (i < month) {
            ctx.fillStyle = SOLID;
            roundRect(ctx, x, y, cellSize, cellSize, 4);
            ctx.fill();
        } else {
            ctx.strokeStyle = HOLLOW;
            ctx.lineWidth = 2;
            roundRect(ctx, x, y, cellSize, cellSize, 4);
            ctx.stroke();
        }
    }

    // 3) 品牌符号（右侧）
    ctx.textAlign = 'center';
    ctx.font = '166px sans-serif';
    ctx.fillText('💩', 408, 228);

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

function getPosterPath() {
    return cachedPath;
}

module.exports = {
    makeShareInfo: makeShareInfo,
    ensurePoster: ensurePoster,
    getPosterPath: getPosterPath,
};
