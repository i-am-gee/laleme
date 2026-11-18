// 订阅消息：一次性订阅，授权一次 = 一条下发额度。
// 所以这里的策略不是"打开开关就一直推"，而是「在用户有正反馈的时刻攒额度」：
// 记录成功后请求一次，把拿到的额度上报给服务端，服务端每天最多用掉一条。

const cloud = require('./cloud.js');

let tplCache = null;

function templates() {
    if (tplCache) {
        return Promise.resolve(tplCache);
    }
    return cloud.call('/api/push/status', 'GET').then(function (res) {
        tplCache = res.templates || {};
        return tplCache;
    });
}

// 拉起订阅弹窗。返回 'accept' | 'reject' | 'skip'
function ask(kind) {
    return templates().then(function (tpl) {
        const id = kind === 'friend' ? tpl.friend : tpl.daily;
        if (!id) {
            return 'skip';
        }
        return new Promise(function (resolve) {
            wx.requestSubscribeMessage({
                tmplIds: [id],
                success(res) {
                    if (res[id] === 'accept') {
                        cloud
                            .call('/api/push/quota', 'POST', { kind: kind, count: 1 })
                            .then(function () { resolve('accept'); })
                            .catch(function () { resolve('accept'); });
                        return;
                    }
                    resolve('reject');
                },
                fail() {
                    resolve('skip');
                },
            });
        });
    }).catch(function () {
        return 'skip';
    });
}

// 记录成功后调用：用户此刻心情最好，通过率最高
function askAfterRecord() {
    const cfg = cloud.readConfig();
    if (!cfg.enabled || !cfg.token) {
        return Promise.resolve('skip');
    }
    return ask('daily');
}

// 查看好友页时调用：为「好友打卡提醒」攒额度
function askForFriendNotify() {
    const cfg = cloud.readConfig();
    if (!cfg.enabled || !cfg.token) {
        return Promise.resolve('skip');
    }
    return ask('friend');
}

function status() {
    return cloud.call('/api/push/status', 'GET');
}

function setSettings(patch) {
    return cloud.call('/api/push/settings', 'POST', patch);
}

module.exports = {
    ask: ask,
    askAfterRecord: askAfterRecord,
    askForFriendNotify: askForFriendNotify,
    status: status,
    setSettings: setSettings,
};
