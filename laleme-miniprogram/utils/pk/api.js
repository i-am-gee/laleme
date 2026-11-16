/**
 * PK 数据门面
 *
 * 页面只 require 这一个文件，永远不知道背后是本地存储还是云端。
 * 接云开发后只需要在 app.js 里：
 *     require('./utils/pk/api.js').setAdapter(require('./utils/pk/remote-api.js'));
 * 其余代码一行不改。
 */

const local = require('./local-api.js');

let adapter = local;

function setAdapter(next) {
    if (next && typeof next.getProfile === 'function') {
        adapter = next;
    }
}

function current() {
    return adapter;
}

function forward(method) {
    return function () {
        return adapter[method].apply(adapter, arguments);
    };
}

/* ---------------- 周期口径 ---------------- */

function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

// 本周一 00:00
function weekSince(now) {
    const d = new Date(startOfDay(now));
    const day = d.getDay(); // 0 是周日
    const offset = day === 0 ? 6 : day - 1;
    return d.getTime() - offset * 24 * 60 * 60 * 1000;
}

// 近 30 天：与统计页「近 30 天」同一口径
function monthSince(now) {
    return startOfDay(now) - 29 * 24 * 60 * 60 * 1000;
}

function periodOf(key, now) {
    const ts = now || Date.now();
    const week = key !== 'month';
    const since = week ? weekSince(ts) : monthSince(ts);
    const date = new Date(since);
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const stamp = y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
    return {
        key: key,
        label: week ? '本周' : '近 30 天',
        since: since,
        // 周期标识用于对齐快照：同一天里反复刷新不会产生不同的 key
        stamp: (week ? 'w' : 'd30') + stamp,
    };
}

module.exports = {
    setAdapter: setAdapter,
    current: current,
    periodOf: periodOf,
    weekSince: weekSince,
    monthSince: monthSince,

    getProfile: forward('getProfile'),
    setNick: forward('setNick'),
    getMode: forward('getMode'),
    enableMode: forward('enableMode'),
    disableMode: forward('disableMode'),
    createInvite: forward('createInvite'),
    readInvite: forward('readInvite'),
    acceptInvite: forward('acceptInvite'),
    declineInvite: forward('declineInvite'),
    listFriends: forward('listFriends'),
    getPeerStats: forward('getPeerStats'),
    pushMyStats: forward('pushMyStats'),
    revoke: forward('revoke'),
};
