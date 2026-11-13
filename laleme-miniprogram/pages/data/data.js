const { pad2 } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const { buildCsv, parseCsv } = require('../../utils/csv.js');
const haptics = require('../../utils/haptics.js');

const store = createRecordStore();

Page({
    data: {
        total: 0,
        pasteText: '',
        status: '',
        statusType: 'info', // info | ok | warn
    },

    onShow() {
        this.refresh();
    },

    refresh() {
        const that = this;
        store.list().then(function (res) {
            that.setData({ total: (res.data || []).length });
        });
    },

    setStatus(text, type) {
        this.setData({ status: text, statusType: type || 'info' });
    },

    /* -------- 导出 -------- */
    exportFile() {
        haptics.tap();
        store.list().then(function (res) {
            if (res.error || !res.data.length) {
                wx.showToast({ title: '暂无数据可导出', icon: 'none' });
                return;
            }
            const csv = buildCsv(res.data);
            const now = new Date();
            const name = 'laleme-' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) + '.csv';
            const path = wx.env.USER_DATA_PATH + '/' + name;
            try {
                wx.getFileSystemManager().writeFileSync(path, csv, 'utf8');
            } catch (e) {
                wx.showToast({ title: '写入文件失败', icon: 'none' });
                return;
            }
            wx.shareFileMessage({
                filePath: path,
                fileName: name,
                fail: function () {
                    wx.setClipboardData({
                        data: csv,
                        success: function () {
                            wx.showToast({ title: '已复制 CSV 到剪贴板', icon: 'none' });
                        },
                    });
                },
            });
        });
    },

    copyCsv() {
        haptics.tap();
        store.list().then(function (res) {
            if (res.error || !res.data.length) {
                wx.showToast({ title: '暂无数据可导出', icon: 'none' });
                return;
            }
            wx.setClipboardData({
                data: buildCsv(res.data),
                success: function () {
                    wx.showToast({ title: '已复制，可发送到电脑保存', icon: 'none' });
                },
            });
        });
    },

    /* -------- 导入 -------- */
    importClipboard() {
        const that = this;
        haptics.tap();
        wx.getClipboardData({
            success: function (res) {
                const text = String(res.data || '');
                if (!text.trim()) {
                    that.setStatus('剪贴板是空的。先在电脑上复制 CSV 内容，或从微信里复制这一份备份。', 'warn');
                    return;
                }
                that.importText(text, '剪贴板');
            },
            fail: function (err) {
                that.setStatus('读取剪贴板失败：' + ((err && err.errMsg) || '未知错误'), 'warn');
            },
        });
    },

    onPasteInput(event) {
        this.setData({ pasteText: event.detail.value });
    },

    importPasted() {
        haptics.tap();
        const text = (this.data.pasteText || '').trim();
        if (!text) {
            this.setStatus('粘贴框是空的，先把 CSV 内容粘进来。', 'warn');
            return;
        }
        this.importText(text, '粘贴内容');
    },

    // 统一导入入口：解析 → 去重 → 逐条写入
    importText(text, sourceLabel) {
        const that = this;
        const rows = parseCsv(text);
        if (!rows.length) {
            this.setStatus('没识别到有效记录：首行应为「时间,时长(分钟),布里斯托类型,感觉」，每行一条。', 'warn');
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
                    step();
                    return;
                }
                existing[key] = true;
                store.create(row).then(function (r) {
                    if (r.error) {
                        skipped += 1;
                    } else {
                        added += 1;
                    }
                    step();
                });
            });
            function step() {
                pending -= 1;
                if (pending !== 0) {
                    return;
                }
                const summary = '识别 ' + rows.length + ' 条 · 新增 ' + added + ' 条 · 跳过 ' + skipped + ' 条';
                if (added > 0) {
                    haptics.tap();
                }
                that.setStatus('来自' + sourceLabel + '：' + summary + (skipped > 0 ? '（跳过的是与现有记录重复或格式不完整的数据）' : ''), added > 0 ? 'ok' : 'warn');
                that.setData({ pasteText: '' });
                that.refresh();
                wx.showToast({
                    title: added > 0 ? '新增 ' + added + ' 条' : '没有新增记录',
                    icon: added > 0 ? 'success' : 'none',
                });
            }
        });
    },

    /* -------- 危险操作 -------- */
    clearAll() {
        const that = this;
        if (!this.data.total) {
            wx.showToast({ title: '暂无数据', icon: 'none' });
            return;
        }
        haptics.tap();
        wx.showModal({
            title: '清空全部数据',
            content: '将删除本机全部 ' + this.data.total + ' 条记录且不可恢复，建议先导出备份。',
            confirmText: '清空',
            confirmColor: '#e24b4a',
            success(result) {
                if (!result.confirm) {
                    return;
                }
                store.removeAll().then(function (r) {
                    if (r.error) {
                        wx.showToast({ title: '清空失败，请重试', icon: 'none' });
                        return;
                    }
                    that.setStatus('已清空全部记录。', 'info');
                    that.refresh();
                    wx.showToast({ title: '已清空', icon: 'success' });
                });
            },
        });
    },
});
