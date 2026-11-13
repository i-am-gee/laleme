App({
    globalData: {
        appName: '拉了么',
        privacyResolve: null,
        // 首页日历点击某天后，把目标日期交给历史页锚定（switchTab 无法带参数）
        historyTargetDay: '',
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
    },
});
