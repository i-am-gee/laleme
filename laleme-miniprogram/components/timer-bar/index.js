// 计时浮条：任意 Tab 页都能看到「还在计时」，点一下回首页继续记录
const timer = require('../../utils/timer.js');
const haptics = require('../../utils/haptics.js');

Component({
    data: {
        show: false,
        text: '00:00',
    },

    lifetimes: {
        attached() {
            this.sync();
        },
        detached() {
            this.clearTick();
        },
    },

    pageLifetimes: {
        show() {
            this.sync();
        },
        hide() {
            this.clearTick();
        },
    },

    methods: {
        sync() {
            const app = getApp();
            if (app && typeof app.settleExpiredTimer === 'function') {
                app.settleExpiredTimer();
            }
            if (!timer.running()) {
                this.clearTick();
                if (this.data.show) {
                    this.setData({ show: false });
                }
                return;
            }
            this.setData({ show: true, text: timer.elapsedText() });
            this.startTick();
        },

        startTick() {
            const that = this;
            this.clearTick();
            this._tick = setInterval(function () {
                if (!timer.running()) {
                    that.clearTick();
                    that.setData({ show: false });
                    return;
                }
                that.setData({ text: timer.elapsedText() });
            }, 1000);
        },

        clearTick() {
            if (this._tick) {
                clearInterval(this._tick);
                this._tick = null;
            }
        },

        // 回到首页并让抽屉自己弹出来
        onTap() {
            haptics.tap();
            const app = getApp();
            if (app && app.globalData) {
                app.globalData.openTimer = true;
            }
            wx.switchTab({ url: '/pages/index/index' });
        },
    },
});
