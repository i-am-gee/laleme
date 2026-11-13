// 本地记录存储层（基于 list-crud 骨架 item-store 的 API 约定改写）
// list / create / update / remove 均返回 { data, error }，不 reject。
// 数据存于本地 wx storage，key 为 laleme_records。
// 后续如需上云，只需把本 store 替换为 cloud-service 的 createTableAccess 返回对象，页面层不变。

const { STORAGE_KEY, pad2 } = require('./constants.js');

const NOT_FOUND_OR_FORBIDDEN_ERROR = {
    code: 'NOT_FOUND_OR_FORBIDDEN',
    message: '没有保存成功，这条记录可能已被删除或无权修改',
};

const INVALID_ID_ERROR = {
    code: 'INVALID_ID',
    message: '缺少记录 id',
};

const INVALID_PAYLOAD_ERROR = {
    code: 'INVALID_PAYLOAD',
    message: '没有可提交的字段',
};

let idCounter = 0;

function createRecordStore() {
    return {
        list() {
            return safely(function () {
                return { data: readRecords(), error: null };
            });
        },

        create(payload) {
            return safely(function () {
                const row = toRow(payload);
                if (!hasWritableFields(row)) {
                    return { data: null, error: INVALID_PAYLOAD_ERROR };
                }
                const now = Date.now();
                const item = {
                    id: createItemId(now),
                    timestamp: row.timestamp,
                    durationMin: row.durationMin,
                    bristol: row.bristol === undefined ? null : row.bristol,
                    mood: row.mood === undefined ? null : row.mood,
                    createdAt: now,
                    updatedAt: now,
                };
                const items = readRecords();
                items.unshift(item);
                writeRecords(items);
                return { data: item, error: null };
            });
        },

        update(id, patch) {
            if (isInvalidId(id)) {
                return Promise.resolve({ data: null, error: INVALID_ID_ERROR });
            }
            return safely(function () {
                const row = toRow(patch);
                if (!hasWritableFields(row)) {
                    return { data: null, error: INVALID_PAYLOAD_ERROR };
                }
                const items = readRecords();
                const index = findIndexById(items, String(id));
                if (index === -1) {
                    return { data: null, error: NOT_FOUND_OR_FORBIDDEN_ERROR };
                }
                const current = items[index];
                const next = {
                    id: current.id,
                    timestamp: row.timestamp === undefined ? current.timestamp : row.timestamp,
                    durationMin: row.durationMin === undefined ? current.durationMin : row.durationMin,
                    bristol: row.bristol === undefined ? current.bristol : row.bristol,
                    mood: row.mood === undefined ? current.mood : row.mood,
                    createdAt: current.createdAt,
                    updatedAt: Date.now(),
                };
                items[index] = next;
                writeRecords(items);
                return { data: next, error: null };
            });
        },

        remove(id) {
            if (isInvalidId(id)) {
                return Promise.resolve({ data: null, error: INVALID_ID_ERROR });
            }
            return safely(function () {
                const itemId = String(id);
                const items = readRecords();
                const filtered = items.filter(function (item) { return item.id !== itemId; });
                const removed = items.length - filtered.length;
                if (removed === 0) {
                    return { data: null, error: NOT_FOUND_OR_FORBIDDEN_ERROR };
                }
                writeRecords(filtered);
                return { data: { removed: removed }, error: null };
            });
        },

        removeAll() {
            return safely(function () {
                writeRecords([]);
                return { data: { removed: true }, error: null };
            });
        },
    };
}

function safely(executor) {
    return Promise.resolve()
        .then(executor)
        .catch(function (error) {
            const message = error && typeof error === 'object' && typeof error.message === 'string'
                ? error.message
                : '';
            return { data: null, error: { code: 'CLIENT_EXCEPTION', message: message } };
        });
}

function hasWritableFields(payload) {
    return payload !== null && typeof payload === 'object' && Object.keys(payload).length > 0;
}

// 从 payload 中提取可写字段；timestamp 为毫秒数、durationMin 为正整数
function toRow(payload) {
    const source = isPlainObject(payload) ? payload : {};
    const row = {};
    const ts = Number(source.timestamp);
    if (Number.isFinite(ts) && ts > 0) {
        row.timestamp = Math.floor(ts);
    }
    const dur = Number(source.durationMin);
    if (Number.isFinite(dur) && dur > 0) {
        row.durationMin = Math.min(Math.round(dur), 720);
    }
    if (source.bristol === null) {
        row.bristol = null;
    } else {
        const b = Number(source.bristol);
        if (Number.isInteger(b) && b >= 1 && b <= 7) {
            row.bristol = b;
        }
    }
    if (source.mood === null) {
        row.mood = null;
    } else if (source.mood === 'good' || source.mood === 'normal' || source.mood === 'hard') {
        row.mood = source.mood;
    }
    return row;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object';
}

function readRecords() {
    const value = wx.getStorageSync(STORAGE_KEY);
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter(isStoredRecord)
        .sort(function (a, b) { return b.timestamp - a.timestamp; })
        .map(function (item) {
            return {
                id: String(item.id),
                timestamp: item.timestamp,
                durationMin: item.durationMin,
                bristol: item.bristol === undefined ? null : item.bristol,
                mood: item.mood === undefined ? null : item.mood,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
            };
        });
}

function writeRecords(items) {
    wx.setStorageSync(STORAGE_KEY, items);
}

function findIndexById(items, itemId) {
    for (let i = 0; i < items.length; i += 1) {
        if (items[i].id === itemId) {
            return i;
        }
    }
    return -1;
}

function createItemId(timestamp) {
    idCounter = (idCounter + 1) % 1000000;
    return String(timestamp) + '-' + String(idCounter) + '-' + pad2(idCounter % 100);
}

function isInvalidId(id) {
    if (typeof id === 'string') {
        return id.trim() === '';
    }
    return true;
}

function isStoredRecord(item) {
    return item !== null
        && typeof item === 'object'
        && (typeof item.id === 'string' || typeof item.id === 'number')
        && typeof item.timestamp === 'number'
        && typeof item.durationMin === 'number';
}

module.exports = {
    createRecordStore: createRecordStore,
};
