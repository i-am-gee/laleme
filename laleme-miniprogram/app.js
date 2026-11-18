const timer = require('./utils/timer.js');
const { createRecordStore } = require('./utils/record-store.js');

const store = createRecordStore();

App({
    globalData: {
        appName: '拉了么',
        privacyResolve: null,
        // 首页日历点击某天后，把目标日期交给历史页锚定（switchTab 无法带参数）
        historyTargetDay: '',
        // 计时浮条被点击后，让首页把记录抽屉弹出来
        openTimer: false,
    },

    onLaunch() {
        // 注册微信官方隐私授权监听：当使用到隐私接口时，弹出同意弹窗
        if (wx.onNeedPrivacyAuthorization) {
            const that = this;
            wx.onNeedPrivacyAuthorization(function (resolve) {
                that.globalData.privacyResolve = resolve;
                const pages = getCurrentPages();
                const current = pages[pages.length - 1];
                if (current && typeof current.showPrivacyPopup === 'function') {
                    current.showPrivacyPopup();
                } else {
                    // 不在首页时先暂存，返回首页后由 onShow 触发
                    wx.setStorageSync('laleme_privacy_pending', Date.now());
                }
            });
        }
        // 冷启动先结算一次，避免带着一个过期计时进来
        this.settleExpiredTimer();
        // 开了云同步的用户，冷启动补一次同步（失败静默，不影响使用）
        this.syncInBackground();
    },

    onShow() {
        // 从后台回来、切页回来都可能产生本地改动，节流后补一次同步
        this.syncInBackground();
    },

    syncInBackground() {
        const cloud = require('./utils/cloud.js');
        const cfg = cloud.readConfig();
        if (!cfg.enabled) {
            return;
        }
        const now = Date.now();
        // 30 秒内不重复触发，避免频繁切页把请求打满
        if (this._lastSyncAt && now - this._lastSyncAt < 30 * 1000) {
            return;
        }
        this._lastSyncAt = now;
        require('./utils/sync.js').syncNow().catch(function () {});
    },

    // 计时超过上限（1 小时）视为忘了结束：直接收尾成一条记录，不让用户白记
    settleExpiredTimer() {
        if (!timer.expired()) {
            return false;
        }
        const durationMin = timer.MAX_MIN;
        timer.stop();
        store
            .create({
                timestamp: Date.now(),
                durationMin: durationMin,
                bristol: null,
                mood: null,
            })
            .then(function (res) {
                if (res.error) {
                    return;
                }
                wx.setStorageSync('laleme_celebrate_flag', Date.now());
                wx.showToast({
                    title: '计时超过 1 小时，已按 ' + durationMin + ' 分钟记下',
                    icon: 'none',
                    duration: 2600,
                });
            });
        return true;
    },
});
