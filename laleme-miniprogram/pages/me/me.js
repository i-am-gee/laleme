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
        dailyRemind: false,
        remindStatus: '开启时授权一次，攒一次提醒',
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
        if (cfg.enabled && cfg.token) {
            const that = this;
            sync.syncNow().then(function () {
                that.refreshCloud();
                that.refresh();
            }).catch(function () {
                that.setData({ cloudStatus: '同步失败，稍后自动重试' });
            });
            this.refreshRemind();
        }
    },

    // 提醒开关与剩余额度：一次性订阅，额度用一次少一次，要让用户看得见
    refreshRemind() {
        const that = this;
        require('../../utils/subscribe.js').preload();
        require('../../utils/subscribe.js').status().then(function (res) {
            const q = (res.quota && res.quota.daily) || 0;
            that.setData({
                dailyRemind: !(res.settings && res.settings.dailyRemind === false),
                remindStatus: q > 0 ? '还剩 ' + q + ' 次可提醒' : '点开关时授权一次，攒一次提醒',
            });
        }).catch(function () {
            that.setData({ remindStatus: '连不上服务器，状态未知' });
        });
    },

    onRemindToggle(e) {
        const on = e.detail.value;
        const that = this;
        const sub = require('../../utils/subscribe.js');
        if (!on) {
            sub.setSettings({ dailyRemind: false }).then(function () {
                haptics.tap();
                that.setData({ dailyRemind: false, remindStatus: '已关闭' });
            }).catch(function (err) {
                that.setData({ dailyRemind: true });
                wx.showToast({ title: err.message || '网络异常，请重试', icon: 'none' });
            });
            return;
        }
        // 必须在点击栈里同步调用，不能先 await 再弹
        sub.askSync('daily').then(function (r) {
            haptics.tap();
            if (r === 'accept') {
                that.setData({ dailyRemind: true });
                that.refreshRemind();
                return;
            }
            // 未授权就把开关弹回去，避免界面显示「已开启」但其实收不到
            that.setData({ dailyRemind: false });
            if (r === 'skip') {
                wx.showToast({ title: '模板未配置，暂不可用', icon: 'none' });
            } else {
                wx.showToast({ title: '未授权，收不到提醒', icon: 'none' });
            }
            that.refreshRemind();
        });
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
                    // 底层 errMsg（如 request:fail net::ERR_CONNECTION_RESET）对用户没有意义，
                    // 统一成一句可理解的提示，细节留给 console
                    console.warn('[cloud] enable failed', err && err.message);
                    wx.showToast({ title: '连不上服务器，请检查网络后重试', icon: 'none' });
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
