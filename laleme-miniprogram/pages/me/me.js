const { dayStr, pad2, bristolLabel, MOOD_TEXT, streakDays } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const share = require('../../utils/share.js');

const store = createRecordStore();

// 与文本对应的满意度 key（导入用）
const MOOD_KEYS = {};
Object.keys(MOOD_TEXT).forEach(function (k) {
    MOOD_KEYS[MOOD_TEXT[k]] = k;
});

Page({
    data: {
        countText: '0 条',
        firstText: '-',
        streakText: '未开始',
    },

    onShow() {
        this.refresh();
    },

    onShareAppMessage() {
        return share.makeShareInfo(this._shareStats);
    },

    goPrivacy() {
        wx.navigateTo({ url: '/pages/privacy/privacy' });
    },

    refresh() {
        const that = this;
        store.list().then(function (res) {
            if (res.error) {
                return;
            }
            const records = res.data;
            let earliest = null;
            records.forEach(function (r) {
                if (earliest === null || r.timestamp < earliest) {
                    earliest = r.timestamp;
                }
            });
            const streak = streakDays(records);
            that._shareStats = { streak: streak, monthDays: monthDaysOf(records) };
            share.ensurePoster(that, that._shareStats);
            that.setData({
                countText: records.length + ' 条',
                firstText: earliest !== null ? dayStr(earliest) : '-',
                streakText: (streak > 0 ? streak : 0) + ' 天',
            });
        });
    },

    /* ---- 数据备份与恢复：ActionSheet 收纳三个入口 ---- */
    openDataManage() {
        const that = this;
        wx.showActionSheet({
            itemList: ['导出数据文件', '从文件导入', '复制 CSV 到剪贴板'],
            success: function (res) {
                if (res.tapIndex === 0) {
                    that.exportFile();
                } else if (res.tapIndex === 1) {
                    that.importFile();
                } else if (res.tapIndex === 2) {
                    that.exportCSV();
                }
            },
            fail: function () {
                // 用户取消
            },
        });
    },

    /* ---- 导出：CSV 文件（可发送给好友/文件传输助手备份） ---- */
    exportFile() {
        store.list().then(function (res) {
            if (res.error || !res.data.length) {
                wx.showToast({ title: '暂无数据可导出', icon: 'none' });
                return;
            }
            const rows = buildCsv(res.data);
            const now = new Date();
            const name = 'laleme-' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) + '.csv';
            const path = wx.env.USER_DATA_PATH + '/' + name;
            try {
                wx.getFileSystemManager().writeFileSync(path, rows.csv, 'utf8');
            } catch (e) {
                wx.showToast({ title: '写入文件失败', icon: 'none' });
                return;
            }
            wx.shareFileMessage({
                filePath: path,
                fail: function () {
                    // 分享面板取消/不支持时，回退剪贴板并保留文件
                    wx.setClipboardData({
                        data: rows.csv,
                        success: function () {
                            wx.showToast({ title: '已复制 CSV，文件已留存', icon: 'none' });
                        },
                    });
                },
            });
        });
    },

    /* ---- 导入：从聊天文件选择 CSV，按 时间+时长 去重合并 ---- */
    importFile() {
        const that = this;
        wx.chooseMessageFile({
            count: 1,
            type: 'file',
            extension: ['csv', 'txt'],
            success: function (res) {
                if (!res.tempFiles || !res.tempFiles.length) {
                    return;
                }
                const path = res.tempFiles[0].path;
                let text = '';
                try {
                    text = wx.getFileSystemManager().readFileSync(path, 'utf8');
                } catch (e) {
                    wx.showToast({ title: '读取文件失败', icon: 'none' });
                    return;
                }
                const rows = parseCsv(String(text));
                if (!rows.length) {
                    wx.showToast({ title: '未识别到有效记录', icon: 'none' });
                    return;
                }
                store.list().then(function (cur) {
                    const existing = {};
                    (cur.data || []).forEach(function (r) {
                        existing[r.timestamp + '|' + r.durationMin] = true;
                    });
                    let added = 0;
                    let skipped = 0;
                    let pending = rows.length;
                    rows.forEach(function (row) {
                        const key = row.timestamp + '|' + row.durationMin;
                        if (existing[key]) {
                            skipped += 1;
                            done();
                            return;
                        }
                        existing[key] = true;
                        store.create(row).then(function (r) {
                            if (!r.error) {
                                added += 1;
                            } else {
                                skipped += 1;
                            }
                            done();
                        });
                    });
                    function done() {
                        pending -= 1;
                        if (pending !== 0) {
                            return;
                        }
                        wx.showModal({
                            title: '导入完成',
                            content: '新增 ' + added + ' 条，跳过 ' + skipped + ' 条（重复或无效）。',
                            showCancel: false,
                            confirmText: '好的',
                        });
                        that.refresh();
                    }
                });
            },
            fail: function () {
                // 用户取消选择
            },
        });
    },

    exportCSV() {
        store.list().then(function (res) {
            if (res.error || !res.data.length) {
                wx.showToast({ title: '暂无数据可导出', icon: 'none' });
                return;
            }
            wx.setClipboardData({
                data: buildCsv(res.data).csv,
                success: function () {
                    wx.showToast({ title: 'CSV 已复制到剪贴板', icon: 'none' });
                },
            });
        });
    },

    clearAll() {
        const that = this;
        if (this.data.countText === '0 条') {
            wx.showToast({ title: '暂无数据', icon: 'none' });
            return;
        }
        wx.showModal({
            title: '清空全部数据',
            content: '将删除本机全部记录且不可恢复，建议先导出备份。',
            confirmText: '清空',
            confirmColor: '#e24b4a',
            success(res) {
                if (!res.confirm) {
                    return;
                }
                store.removeAll().then(function (r2) {
                    if (r2.error) {
                        wx.showToast({ title: '清空失败，请重试', icon: 'none' });
                        return;
                    }
                    that.refresh();
                    wx.showToast({ title: '已清空', icon: 'success' });
                });
            },
        });
    },
});

// 组装 CSV 文本
function buildCsv(records) {
    const rows = [['时间', '时长(分钟)', '布里斯托类型', '感觉']];
    records.forEach(function (r) {
        rows.push([
            new Date(r.timestamp).toISOString(),
            String(r.durationMin),
            bristolLabel(r.bristol),
            r.mood ? MOOD_TEXT[r.mood] : '未记',
        ]);
    });
    const csv = rows.map(function (row) {
        return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    return { csv: csv };
}

// CSV 解析：支持引号转义；返回 [{timestamp, durationMin, bristol, mood}]
function parseCsv(text) {
    const lines = String(text).split(/\r?\n/);
    const out = [];
    lines.forEach(function (line, idx) {
        if (!line.trim()) {
            return;
        }
        const cells = splitLine(line);
        if (idx === 0 && cells[0] === '时间') {
            return; // 表头
        }
        const ts = Date.parse(cells[0]);
        const dur = parseInt(cells[1], 10);
        if (!Number.isFinite(ts) || !Number.isFinite(dur) || dur <= 0) {
            return;
        }
        let bristol = null;
        const m = String(cells[2] || '').match(/^([1-7])/);
        if (m) {
            bristol = parseInt(m[1], 10);
        }
        let mood = null;
        if (cells[3] && MOOD_KEYS[cells[3]]) {
            mood = MOOD_KEYS[cells[3]];
        }
        out.push({
            timestamp: ts,
            durationMin: Math.min(dur, 720),
            bristol: bristol,
            mood: mood,
        });
    });
    return out;
}

function splitLine(line) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            cells.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    cells.push(cur);
    return cells;
}

// 本月打卡天数（与首页日历口径一致）
function monthDaysOf(records) {
    const now = new Date();
    const prefix = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-';
    const seen = {};
    records.forEach(function (r) {
        const s = dayStr(r.timestamp);
        if (s.indexOf(prefix) === 0) {
            seen[s] = true;
        }
    });
    return Object.keys(seen).length;
}
