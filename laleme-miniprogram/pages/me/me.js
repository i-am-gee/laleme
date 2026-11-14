const { dayStr, streakDays } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const haptics = require('../../utils/haptics.js');
const share = require('../../utils/share.js');
const { getNavTop } = require('../../utils/nav.js');

const store = createRecordStore();

Page({
    data: {
        countText: '0 条',
        firstText: '-',
        streakText: '未开始',
        navTop: 72,
    },

    onLoad() {
        this.setData({ navTop: getNavTop() });
    },

    onShow() {
        syncTabBar(this, 3);
        this.refresh();
    },

    onReady() {
        if (this._shareStats) {
            share.ensurePoster(this, this._shareStats);
        }
    },

    onShareAppMessage() {
        return share.makeShareInfo(this._shareStats);
    },

    // 分享按钮按下即震
    onShareTouch() {
        haptics.tap();
    },

    goPrivacy() {
        haptics.tap();
        wx.navigateTo({ url: '/pages/privacy/privacy' });
    },

    goDataPage() {
        haptics.tap();
        wx.navigateTo({ url: '/pages/data/data' });
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
            const stats = share.makeStats(records);
            that._shareStats = stats;
            share.ensurePoster(that, stats);
            that.setData({
                countText: records.length + ' 条',
                firstText: earliest !== null ? dayStr(earliest) : '-',
                streakText: streakDays(records) + ' 天',
            });
        });
    },

    clearAll() {
        const that = this;
        if (this.data.countText === '0 条') {
            wx.showToast({ title: '暂无数据', icon: 'none' });
            return;
        }
        haptics.tap();
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

// 自定义 tabBar 需要页面自己同步选中项
function syncTabBar(page, index) {
    if (typeof page.getTabBar !== 'function') {
        return;
    }
    const bar = page.getTabBar();
    if (bar && bar.setData) {
        bar.setData({ selected: index });
    }
}
