// 同步引擎：本地优先。
// 规则：本地永远是主存储，界面不等网络；云端只负责「换个手机还能回来」。
// 冲突：同一 id 以 updatedAt 大者为准；删除用墓碑（tombstone）同步，避免删了又被旧数据推回来。

const cloud = require('./cloud.js');
const { STORAGE_KEY } = require('./constants.js');

const TOMB_KEY = 'laleme_tombstones';
const BATCH = 200;

function readRecords() {
    const raw = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(raw) ? raw : [];
}

function writeRecords(list) {
    wx.setStorageSync(STORAGE_KEY, list);
}

function readTombstones() {
    const raw = wx.getStorageSync(TOMB_KEY);
    return Array.isArray(raw) ? raw : [];
}

function writeTombstones(list) {
    wx.setStorageSync(TOMB_KEY, list);
}

// 记录删除时留一块墓碑，等同步把它送到云端
function markDeleted(id) {
    const list = readTombstones();
    list.push({ id: id, updatedAt: Date.now() });
    writeTombstones(list);
}

function toRemote(rec) {
    return {
        clientId: rec.id,
        ts: rec.timestamp,
        durationMin: rec.durationMin,
        bristol: rec.bristol === undefined ? null : rec.bristol,
        mood: rec.mood === undefined ? null : rec.mood,
        color: rec.color === undefined ? null : rec.color,
        updatedAt: rec.updatedAt || rec.createdAt || rec.timestamp,
        deleted: false,
    };
}

/* ------------------------------ 推送 ------------------------------ */

function pushAll() {
    const records = readRecords().map(toRemote);
    const tombs = readTombstones().map(function (t) {
        return { clientId: t.id, ts: t.updatedAt, durationMin: 1, updatedAt: t.updatedAt, deleted: true };
    });
    const all = records.concat(tombs);
    if (!all.length) {
        return Promise.resolve({ pushed: 0 });
    }

    const chunks = [];
    for (let i = 0; i < all.length; i += BATCH) {
        chunks.push(all.slice(i, i + BATCH));
    }

    let pushed = 0;
    return chunks.reduce(function (chain, chunk) {
        return chain.then(function () {
            return cloud.call('/api/sync/push', 'POST', { records: chunk }).then(function (res) {
                pushed += (res.accepted || []).length;
                // 已被云端接受的墓碑可以清掉，没接受的下次再试
                const acceptedIds = new Set(res.accepted || []);
                const rest = readTombstones().filter(function (t) {
                    return !acceptedIds.has(t.id);
                });
                writeTombstones(rest);
            });
        });
    }, Promise.resolve()).then(function () {
        return { pushed: pushed };
    });
}

/* ------------------------------ 拉取 ------------------------------ */

function mergeRemote(rows) {
    const local = readRecords();
    const byId = new Map();
    local.forEach(function (r) {
        byId.set(r.id, r);
    });
    let added = 0;
    let updated = 0;
    let removed = 0;

    rows.forEach(function (row) {
        const cur = byId.get(row.clientId);
        if (row.deleted) {
            if (cur) {
                byId.delete(row.clientId);
                removed += 1;
            }
            return;
        }
        if (!cur) {
            byId.set(row.clientId, {
                id: row.clientId,
                timestamp: row.ts,
                durationMin: row.durationMin,
                bristol: row.bristol,
                mood: row.mood,
                color: row.color,
                createdAt: row.updatedAt,
                updatedAt: row.updatedAt,
            });
            added += 1;
            return;
        }
        if (row.updatedAt > (cur.updatedAt || 0)) {
            byId.set(row.clientId, Object.assign({}, cur, {
                timestamp: row.ts,
                durationMin: row.durationMin,
                bristol: row.bristol,
                mood: row.mood,
                color: row.color,
                updatedAt: row.updatedAt,
            }));
            updated += 1;
        }
    });

    const merged = Array.from(byId.values()).sort(function (a, b) {
        return b.timestamp - a.timestamp;
    });
    writeRecords(merged);
    return { added: added, updated: updated, removed: removed, total: merged.length };
}

function pullAll() {
    let cursor = cloud.readConfig().cursor || 0;
    const rows = [];
    function step() {
        return cloud.call('/api/sync/pull?since=' + cursor + '&limit=' + BATCH, 'GET').then(function (res) {
            (res.records || []).forEach(function (r) {
                rows.push(r);
            });
            cursor = res.cursor || cursor;
            if (res.hasMore) {
                return step();
            }
            return null;
        });
    }
    return step().then(function () {
        const stat = mergeRemote(rows);
        cloud.writeConfig({ cursor: cursor, lastSync: Date.now() });
        return Object.assign({ pulled: rows.length }, stat);
    });
}

/* ------------------------------ 对外 ------------------------------ */

function syncNow() {
    const cfg = cloud.readConfig();
    if (!cfg.enabled) {
        return Promise.resolve({ skipped: true });
    }
    if (!cfg.token) {
        return Promise.resolve({ skipped: true, reason: 'not_logged_in' });
    }
    if (this._running) {
        return this._running;
    }
    const that = this;
    that._running = pushAll()
        .then(function () {
            return pullAll();
        })
        .then(function (stat) {
            that._running = null;
            return stat;
        })
        .catch(function (err) {
            that._running = null;
            throw err;
        });
    return that._running;
}

// 首次开启：登录换令牌 → 把本地全部推上去 → 再拉一次（合并其他设备的数据）
function enable(profile) {
    cloud.writeConfig({ enabled: true, cursor: 0, token: '' });
    return cloud.login(profile || {}).then(function (res) {
        return syncNow().then(function (stat) {
            return { profile: res.profile, recordCount: res.recordCount, stat: stat };
        });
    });
}

function disable() {
    cloud.writeConfig({ enabled: false });
    return Promise.resolve({ ok: true });
}

module.exports = {
    enable: enable,
    disable: disable,
    syncNow: syncNow,
    pushAll: pushAll,
    pullAll: pullAll,
    mergeRemote: mergeRemote,
    markDeleted: markDeleted,
    readRecords: readRecords,
};
