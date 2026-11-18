const { dayStr, streakDays } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const haptics = require('../../utils/haptics.js');
const share = require('../../utils/share.js');
const { getNavTop } = require('../../utils/nav.js');
const cloud = require('../../utils/cloud.js');
const sync = require('../../utils/sync.js');

const store = createRecordStore();

Page({
    data: {
        countText: '0 条',
        firstText: '-',
        streakText: '未开始',
        navTop: 72,
        cloudOn: false,
        cloudStatus: '未同步',
    },

    onLoad() {
        this.setData({ navTop: getNavTop() });
    },

    onShow() {
        syncTabBar(this, 3);
        this.refresh();
        this.refreshCloud();
    },

    refreshCloud() {
        const cfg = cloud.readConfig();
        const last = cfg.lastSync ? dayStr(cfg.lastSync) : '';
        this.setData({
            cloudOn: !!cfg.enabled,
            cloudStatus: cfg.lastSync ? '已同步 · 最近 ' + last : '等待首次同步',
        });
        if (cfg.enabled) {
            const that = this;
            sync.syncNow().then(function () {
                that.refreshCloud();
                that.refresh();
            }).catch(function () {});
        }
    },

    // 开启：先让用户知道传什么，再登录并把本地全部推上去
    onCloudToggle(e) {
        const that = this;
        const on = e.detail.value;
        if (!on) {
            sync.disable().then(function () {
                haptics.tap();
                that.refreshCloud();
                wx.showToast({ title: '已关闭云同步', icon: 'none' });
            });
            return;
        }
        wx.showModal({
            title: '开启云同步',
            content: '开启后，记录会上传到云端，用于换手机或清缓存后恢复。数据只用于你本人的记录恢复，不会展示给任何人。可随时关闭并删除云端数据。',
            confirmText: '开启',
            cancelText: '再想想',
            success(res) {
                if (!res.confirm) {
                    that.setData({ cloudOn: false });
                    return;
                }
                wx.showLoading({ title: '同步中' });
                sync.enable({}).then(function () {
                    wx.hideLoading();
                    haptics.tap();
                    that.refreshCloud();
                    that.refresh();
                    wx.showToast({ title: '已开启', icon: 'success' });
                }).catch(function (err) {
                    wx.hideLoading();
                    that.setData({ cloudOn: false });
                    wx.showToast({ title: err.message || '同步失败', icon: 'none' });
                });
            },
        });
    },

    onReady() {
        if (this._shareStats) {
            share.ensurePoster(this, this._shareStats);
        }
    },

    onShareAppMessage() {
        share.trackShare();
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

    // 小程序不能直接跳外链，复制仓库地址是最稳的落地方式
    copyRepo() {
        haptics.tap();
        wx.setClipboardData({
            data: 'https://github.com/i-am-gee/laleme',
            success: function () {
                wx.showToast({ title: '仓库地址已复制', icon: 'none' });
            },
        });
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
