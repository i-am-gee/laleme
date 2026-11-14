// 全局计时：一次「记一次」就是一段可以随时离开的计时
//
// 状态以「开始时间戳」存在本机，页面来去、切后台都不影响，
// 显示时再用差值换算，不依赖 setInterval 的次数。
// 超过 MAX_MIN 分钟视为忘了结束，由调用方触发自动收尾。

const KEY = 'laleme_timer_start';
const MAX_MIN = 60;

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

function startAt() {
    const v = Number(wx.getStorageSync(KEY));
    return isFinite(v) && v > 0 ? v : 0;
}

function start() {
    wx.setStorageSync(KEY, Date.now());
}

function stop() {
    wx.removeStorageSync(KEY);
}

function running() {
    return startAt() > 0;
}

function expired() {
    const t = startAt();
    return t > 0 && Date.now() - t >= MAX_MIN * 60000;
}

function elapsedSec() {
    const t = startAt();
    if (!t) {
        return 0;
    }
    return Math.max(0, Math.min(MAX_MIN * 60, Math.floor((Date.now() - t) / 1000)));
}

// 「12:34」，用于按钮与浮条
function elapsedText() {
    const s = elapsedSec();
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
}

// 落库用的分钟数，至少 1 分钟，最多 MAX_MIN
function elapsedMin() {
    const t = startAt();
    if (!t) {
        return 0;
    }
    const min = Math.round((Date.now() - t) / 60000);
    return Math.max(1, Math.min(MAX_MIN, min || 1));
}

module.exports = {
    start: start,
    stop: stop,
    running: running,
    expired: expired,
    startAt: startAt,
    elapsedSec: elapsedSec,
    elapsedText: elapsedText,
    elapsedMin: elapsedMin,
    MAX_MIN: MAX_MIN,
};
