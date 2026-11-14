const { pad2 } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const { buildCsv, parseCsv } = require('../../utils/csv.js');
const haptics = require('../../utils/haptics.js');
const share = require('../../utils/share.js');

const store = createRecordStore();

Page({
    data: {
        total: 0,
        pasteText: '',
        pasteOpen: false,
        status: '',
        statusType: 'info', // info | ok | warn
        resultShow: false,
        resultTotal: 0,
        resultAdded: 0,
        resultSkipped: 0,
        resultShare: '',
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
            const csv = buildCsv(res.data, share.shareMeta());
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
                data: buildCsv(res.data, share.shareMeta()),
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

    togglePaste() {
        haptics.light();
        this.setData({ pasteOpen: !this.data.pasteOpen });
    },

    closeResult() {
        haptics.tap();
        this.setData({ resultShow: false });
    },

    noop() {},

    importPasted() {
        haptics.tap();
        const text = (this.data.pasteText || '').trim();
        if (!text) {
            this.setStatus('粘贴框是空的，先把 CSV 内容粘进来。', 'warn');
            return;
        }
        this.importText(text, '粘贴内容');
    },

    // 分享进度随备份一起恢复：合并语义，取本地与备份的较大值，不降级
    applyShareMeta(meta) {
        if (!meta || (!meta.shareCount && !meta.shareBadge)) {
            return '';
        }
        const cur = share.shareMeta();
        const count = Math.max(cur.shareCount, meta.shareCount || 0);
        const badge = cur.shareBadge || !!meta.shareBadge;
        if (count === cur.shareCount && badge === cur.shareBadge) {
            return '';
        }
        share.setShareState(count, badge);
        if (badge && !cur.shareBadge) {
            return '「大屎官」称号已一并恢复';
        }
        return '分享进度已一并恢复';
    },

    // 统一导入入口：解析 → 比对差异 → 用户确认 → 才真正写入
    importText(text, sourceLabel) {
        const that = this;
        const parsed = parseCsv(text);
        const rows = parsed.rows;
        const meta = parsed.meta;
        if (!rows.length && !meta.shareCount && !meta.shareBadge) {
            this.setStatus('没识别到有效记录：首行应为「时间,时长(分钟),布里斯托类型,感觉」，每行一条。', 'warn');
            return;
        }
        store.list().then(function (cur) {
            const existing = {};
            (cur.data || []).forEach(function (r) {
                existing[r.timestamp + '|' + r.durationMin] = true;
            });

            // 先把差异算清楚，一个字都没写
            const fresh = [];
            let dup = 0;
            rows.forEach(function (row) {
                const key = row.timestamp + '|' + row.durationMin;
                if (existing[key]) {
                    dup += 1;
                    return;
                }
                existing[key] = true;
                fresh.push(row);
            });

            const curMeta = share.shareMeta();
            const nextCount = Math.max(curMeta.shareCount, meta.shareCount || 0);
            const nextBadge = curMeta.shareBadge || !!meta.shareBadge;

            const parts = [];
            if (fresh.length) {
                parts.push('新增 ' + fresh.length + ' 条记录');
            }
            if (dup) {
                parts.push('跳过 ' + dup + ' 条已有记录');
            }
            if (nextBadge && !curMeta.shareBadge) {
                parts.push('恢复「黄金大屎官」称号');
            } else if (nextCount > curMeta.shareCount) {
                parts.push('分享进度 ' + curMeta.shareCount + ' → ' + nextCount + ' 次');
            }

            if (!parts.length) {
                that.setStatus('这份备份与现有数据完全一致，没有需要导入的内容。', 'info');
                return;
            }

            wx.showModal({
                title: '确认导入',
                // showModal 的 content 不吃换行，改用分号把差异串成一句
                content: parts.join('；') + '。导入后不可撤销，确定继续？',
                confirmText: '导入',
                cancelText: '再看看',
                success(res) {
                    if (!res.confirm) {
                        that.setStatus('已取消，数据没有变化。', 'info');
                        return;
                    }
                    that.doImport(fresh, dup, rows.length, meta);
                },
            });
        });
    },

    // 用户确认后才落地
    doImport(fresh, dup, total, meta) {
        const that = this;
        const shareNote = this.applyShareMeta(meta);
        const finish = function (added, skipped) {
            if (added > 0) {
                haptics.tap();
            }
            that.setData({
                pasteText: '',
                status: '',
                resultShow: true,
                resultTotal: total,
                resultAdded: added,
                resultSkipped: skipped,
                resultShare: shareNote,
            });
            that.refresh();
        };
        if (!fresh.length) {
            finish(0, dup);
            return;
        }
        let added = 0;
        let skipped = dup;
        let pending = fresh.length;
        fresh.forEach(function (row) {
            store.create(row).then(function (r) {
                if (r.error) {
                    skipped += 1;
                } else {
                    added += 1;
                }
                pending -= 1;
                if (pending === 0) {
                    finish(added, skipped);
                }
            });
        });
    },

    /* -------- 危险操作 -------- */
    clearAll() {
        const that = this;
        const meta = share.shareMeta();
        const hasShare = meta.shareCount > 0 || meta.shareBadge;
        if (!this.data.total && !hasShare) {
            wx.showToast({ title: '暂无数据', icon: 'none' });
            return;
        }
        haptics.tap();
        const content = this.data.total
            ? '将删除本机全部 ' + this.data.total + ' 条记录，以及分享进度和「大屎官」称号，不可恢复。建议先导出备份。'
            : '将删除分享进度和「大屎官」称号，不可恢复。';
        wx.showModal({
            title: '清空全部数据',
            content: content,
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
                    // 分享进度、称号与未保存的草稿一并抹掉，等同于「这个用户从未来过」
                    share.clearShareState();
                    wx.removeStorageSync('laleme_draft');
                    that.setStatus('已清空全部数据，包括分享进度与称号。', 'info');
                    that.refresh();
                    wx.showToast({ title: '已清空', icon: 'success' });
                });
            },
        });
    },
});
