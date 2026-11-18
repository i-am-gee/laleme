// 订阅消息：一次性订阅，授权一次 = 一条下发额度。
//
// 微信硬约束：wx.requestSubscribeMessage 必须在「用户点击」的同步调用栈里发起，
// 一旦中间隔了 await / Promise.then，就会报
// "can only be invoked by user TAP gesture"。
// 所以模板 ID 要提前取好放本地缓存，点击时同步调用 askSync()。

const cloud = require('./cloud.js');

let tplCache = null;

// 提前把模板 ID 拿到手：应用启动、页面显示时调用，异步无所谓
function preload() {
    if (tplCache) {
        return Promise.resolve(tplCache);
    }
    return cloud.call('/api/push/templates', 'GET')
        .then(function (res) {
            tplCache = { daily: res.daily, friend: res.friend };
            return tplCache;
        })
        .catch(function () {
            return null;
        });
}

function templateOf(kind) {
    if (!tplCache) {
        return '';
    }
    return kind === 'friend' ? tplCache.friend || '' : tplCache.daily || '';
}

// 只能在点击事件里同步调用
function askSync(kind) {
    const id = templateOf(kind);
    if (!id) {
        preload();
        return Promise.resolve('skip');
    }
    return new Promise(function (resolve) {
        wx.requestSubscribeMessage({
            tmplIds: [id],
            success(res) {
                if (res[id] === 'accept') {
                    // 上报额度是异步的，与弹窗无关，不影响授权结果
                    cloud.ensureToken()
                        .then(function () {
                            return cloud.call('/api/push/quota', 'POST', { kind: kind, count: 1 });
                        })
                        .catch(function () {});
                    resolve('accept');
                    return;
                }
                resolve('reject');
            },
            fail(err) {
                resolve(String(err.errMsg || '').indexOf('TAP') >= 0 ? 'no-gesture' : 'fail');
            },
        });
    });
}

// 记录保存成功后调用：只做后续收尾，不再弹窗（此时已脱离点击栈）
function afterRecord() {
    return preload();
}

function status() {
    return cloud.ensureToken()
        .then(function () {
            return cloud.call('/api/push/status', 'GET');
        })
        .then(function (res) {
            tplCache = res.templates || tplCache;
            return res;
        });
}

function setSettings(patch) {
    return cloud.ensureToken().then(function () {
        return cloud.call('/api/push/settings', 'POST', patch);
    });
}

module.exports = {
    preload: preload,
    askSync: askSync,
    afterRecord: afterRecord,
    status: status,
    setSettings: setSettings,
};
