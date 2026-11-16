const pk = require('../../utils/pk/api.js');
const haptics = require('../../utils/haptics.js');

Page({
    data: {
        ready: false,
        invalid: false,
        reason: '',
        fromNick: '',
        fromInitial: '💩',
        shared: ['记录次数', '平均时长', '质量分'],
        submitting: false,
    },

    onLoad(options) {
        const token = options && options.t;
        if (!token) {
            this.setData({ ready: true, invalid: true, reason: '邀请链接不完整' });
            return;
        }
        this._token = token;
        const that = this;
        pk.readInvite(token).then(function (info) {
            if (info.isSelf) {
                that.setData({
                    ready: true,
                    invalid: true,
                    reason: '这是你自己发起的邀请，转给朋友试试',
                });
                return;
            }
            if (info.expired) {
                that.setData({
                    ready: true,
                    invalid: true,
                    reason: '邀请已过期，让朋友重新发一次',
                });
                return;
            }
            that.setData({
                ready: true,
                fromNick: info.fromNick,
                fromInitial: String(info.fromNick || '💩').slice(0, 1),
            });
        }).catch(function () {
            that.setData({ ready: true, invalid: true, reason: '邀请已失效' });
        });
    },

    accept() {
        if (this.data.submitting || !this._token) {
            return;
        }
        const that = this;
        haptics.strong();
        this.setData({ submitting: true });
        // 先开启模式，再落关系：顺序反了会在 PK 页出现「未开启但有好友」的中间态
        pk.enableMode()
            .then(function () {
                return pk.acceptInvite(that._token);
            })
            .then(function () {
                wx.redirectTo({ url: '/pages/pk/pk' });
            })
            .catch(function (err) {
                that.setData({ submitting: false });
                wx.showToast({
                    title: (err && err.message) || '没能建立关系，稍后再试',
                    icon: 'none',
                });
            });
    },

    decline() {
        haptics.tap();
        wx.navigateBack({
            fail() {
                wx.switchTab({ url: '/pages/index/index' });
            },
        });
    },

    goHome() {
        wx.switchTab({ url: '/pages/index/index' });
    },
});
