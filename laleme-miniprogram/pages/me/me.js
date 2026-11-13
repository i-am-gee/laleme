const { dayStr, fmtDur, bristolLabel, MOOD_TEXT, streakDays } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');

const store = createRecordStore();

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
        const streak = parseInt(this.data.streakText, 10) || 0;
        return {
            title: '我已在「拉了么」连续打卡 ' + streak + ' 天，来挑战我！💩',
            path: '/pages/index/index?challenge=1&streak=' + streak + '&month=0',
        };
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
            that.setData({
                countText: records.length + ' 条',
                firstText: earliest !== null ? dayStr(earliest) : '-',
                streakText: (streakDays(records) > 0 ? streakDays(records) : 0) + ' 天',
            });
        });
    },

    exportCSV() {
        const that = this;
        store.list().then(function (res) {
            if (res.error || !res.data.length) {
                wx.showToast({ title: '暂无数据可导出', icon: 'none' });
                return;
            }
            const rows = [['时间', '时长(分钟)', '布里斯托类型', '感觉']];
            res.data.forEach(function (r) {
                rows.push([
                    new Date(r.timestamp).toLocaleString('zh-CN'),
                    String(r.durationMin),
                    bristolLabel(r.bristol),
                    r.mood ? MOOD_TEXT[r.mood] : '未记',
                ]);
            });
            const csv = rows.map(function (row) {
                return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
            }).join('\n');
            wx.setClipboardData({
                data: csv,
                success() {
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
            content: '将删除本机全部记录且不可恢复，建议先导出 CSV 备份。',
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
