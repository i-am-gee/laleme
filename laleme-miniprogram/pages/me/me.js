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
