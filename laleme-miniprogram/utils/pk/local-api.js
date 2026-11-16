/**
 * PK 的本地实现（尚未接入服务端时的适配器）
 *
 * 契约与云端版本保持一致：所有方法返回 Promise，失败一律 reject。
 * 页面只依赖 api.js，切换实现时不需要改任何页面代码。
 *
 * 诚实说明：本实现没有跨设备能力。
 * 邀请 token 里只带邀请人的身份与昵称，对方的统计要靠服务端下发；
 * 在本地模式下对端数据永远是 null，页面会显示「等待对方同步」。
 * 这是刻意的——不在客户端伪造好友数据。
 */

const K_PROFILE = 'laleme_pk_profile';
const K_MODE = 'laleme_pk_mode';
const K_FRIENDS = 'laleme_pk_friends';
const K_PEER_STATS = 'laleme_pk_peer_stats';

const INVITE_TTL = 48 * 60 * 60 * 1000;
const LATENCY = 120;

function later(fn) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            try {
                resolve(fn());
            } catch (err) {
                reject(err);
            }
        }, LATENCY);
    });
}

function randomNick() {
    const pool = ['阿屎', '小拉', '便便侠', '金屎官', '马桶哲学家'];
    const base = pool[Math.floor(Math.random() * pool.length)];
    return base + (10 + Math.floor(Math.random() * 90));
}

function makeId() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readProfile() {
    const saved = wx.getStorageSync(K_PROFILE);
    if (saved && saved.id) {
        return saved;
    }
    const fresh = { id: makeId(), nick: randomNick() };
    wx.setStorageSync(K_PROFILE, fresh);
    return fresh;
}

function readFriends() {
    const list = wx.getStorageSync(K_FRIENDS);
    return Array.isArray(list) ? list : [];
}

function writeFriends(list) {
    wx.setStorageSync(K_FRIENDS, list);
}

function readPeerStats() {
    const map = wx.getStorageSync(K_PEER_STATS);
    return map && typeof map === 'object' ? map : {};
}

/* ---------------- 邀请 token ---------------- */

function encodeInvite(profile) {
    const payload = { f: profile.id, n: profile.nick, t: Date.now() };
    return encodeURIComponent(JSON.stringify(payload));
}

// 微信会把 query 解码一次，这里两种形态都尝试，避免中文昵称解析失败
function decodeInvite(token) {
    if (!token) {
        return null;
    }
    let raw = null;
    try {
        raw = JSON.parse(token);
    } catch (e1) {
        try {
            raw = JSON.parse(decodeURIComponent(token));
        } catch (e2) {
            return null;
        }
    }
    if (!raw || !raw.f) {
        return null;
    }
    return raw;
}

/* ---------------- 对外接口 ---------------- */

function getProfile() {
    return later(function () {
        return readProfile();
    });
}

function setNick(nick) {
    return later(function () {
        const name = String(nick || '').trim().slice(0, 12);
        if (!name) {
            throw new Error('昵称不能为空');
        }
        const profile = readProfile();
        profile.nick = name;
        wx.setStorageSync(K_PROFILE, profile);
        return profile;
    });
}

function getMode() {
    return later(function () {
        return !!wx.getStorageSync(K_MODE);
    });
}

function enableMode() {
    return later(function () {
        wx.setStorageSync(K_MODE, 1);
        return true;
    });
}

// 退出 PK：连同关系与对端快照一起清掉，等同「没参与过」
function disableMode() {
    return later(function () {
        wx.removeStorageSync(K_MODE);
        wx.removeStorageSync(K_FRIENDS);
        wx.removeStorageSync(K_PEER_STATS);
        return true;
    });
}

function createInvite() {
    return later(function () {
        const profile = readProfile();
        return {
            token: encodeInvite(profile),
            expireAt: Date.now() + INVITE_TTL,
        };
    });
}

function readInvite(token) {
    return later(function () {
        const raw = decodeInvite(token);
        if (!raw) {
            throw new Error('邀请已失效');
        }
        const me = readProfile();
        return {
            fromId: raw.f,
            fromNick: raw.n || '一位朋友',
            expired: Date.now() - raw.t > INVITE_TTL,
            isSelf: raw.f === me.id,
        };
    });
}

function acceptInvite(token) {
    return later(function () {
        const raw = decodeInvite(token);
        if (!raw) {
            throw new Error('邀请已失效');
        }
        const me = readProfile();
        if (raw.f === me.id) {
            throw new Error('不能和自己 PK');
        }
        if (Date.now() - raw.t > INVITE_TTL) {
            throw new Error('邀请已过期');
        }
        const list = readFriends();
        const exists = list.filter(function (f) {
            return f.id === raw.f;
        })[0];
        if (exists) {
            return exists;
        }
        const friend = {
            id: raw.f,
            nick: raw.n || '一位朋友',
            since: Date.now(),
        };
        list.unshift(friend);
        writeFriends(list);
        return friend;
    });
}

function declineInvite(token) {
    return later(function () {
        return true;
    });
}

function listFriends() {
    return later(function () {
        return readFriends();
    });
}

// 对端的周期统计。本地模式一律为 null——页面据此显示「等待对方同步」
function getPeerStats(peerId, periodKey) {
    return later(function () {
        const map = readPeerStats();
        const byPeer = map[peerId];
        if (!byPeer || !byPeer[periodKey]) {
            return null;
        }
        return byPeer[periodKey];
    });
}

// 本机统计的「上传」。本地实现只落盘留痕，服务端版本会写 records 并返回权威分
function pushMyStats(periodKey, stats) {
    return later(function () {
        const key = 'laleme_pk_my_stats';
        const map = wx.getStorageSync(key) || {};
        map[periodKey] = stats;
        wx.setStorageSync(key, map);
        return stats;
    });
}

function revoke(peerId) {
    return later(function () {
        const list = readFriends().filter(function (f) {
            return f.id !== peerId;
        });
        writeFriends(list);
        const map = readPeerStats();
        if (map[peerId]) {
            delete map[peerId];
            wx.setStorageSync(K_PEER_STATS, map);
        }
        return true;
    });
}

module.exports = {
    name: 'local',
    getProfile: getProfile,
    setNick: setNick,
    getMode: getMode,
    enableMode: enableMode,
    disableMode: disableMode,
    createInvite: createInvite,
    readInvite: readInvite,
    acceptInvite: acceptInvite,
    declineInvite: declineInvite,
    listFriends: listFriends,
    getPeerStats: getPeerStats,
    pushMyStats: pushMyStats,
    revoke: revoke,
    encodeInvite: encodeInvite,
    decodeInvite: decodeInvite,
};
