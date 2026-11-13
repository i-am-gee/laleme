// 分享公共模块：5:4 分享卡片海报绘制（适配微信缩略图，不裁切）+ 三页统一分享内容
// 海报缓存于模块级变量：同统计数据只绘制一次，index/stats/me 共用
const { SHARE_TITLES } = require('./constants.js');

let cachedPath = '';
let cachedKey = '';

function posterKey(stats) {
    return (stats.streak || 0) + '|' + (stats.monthDays || 0);
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
    ctx.fillRect(0, 0, W, 10);
    ctx.fillRect(0, H - 10, W, 10);

    // 品牌区（左上）
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8B5E3C';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText('拉了么', 36, 70);
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#854F0B';
    ctx.fillText('肠道健康打卡', 38, 100);

    // 大便便（右侧）
    ctx.textAlign = 'center';
    ctx.font = '150px sans-serif';
    ctx.fillText('💩', 388, 240);

    // 数据区（左中）
    const streak = (stats && stats.streak) || 0;
    const month = (stats && stats.monthDays) || 0;
    ctx.textAlign = 'left';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = '#2C2C2A';
    ctx.fillText('连续打卡 ' + streak + ' 天', 36, 205);
    ctx.font = '30px sans-serif';
    ctx.fillStyle = '#444441';
    ctx.fillText('本月打卡 ' + month + ' 天', 36, 250);

    // 行动号召（左下）
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = '#0F6E56';
    ctx.fillText('来挑战我吧！', 36, 325);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#888780';
    ctx.fillText('记录每一次，读懂你的肠道', 38, 356);

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

function getPosterPath() {
    return cachedPath;
}

module.exports = {
    makeShareInfo: makeShareInfo,
    ensurePoster: ensurePoster,
    getPosterPath: getPosterPath,
};
