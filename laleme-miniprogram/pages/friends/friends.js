const cloud = require('../../utils/cloud.js');
const subscribe = require('../../utils/subscribe.js');
const haptics = require('../../utils/haptics.js');
const { getNavTop } = require('../../utils/nav.js');

const TIER_ICON_BY_LEVEL = [
    '/assets/rank/bronze.png',
    '/assets/rank/silver.png',
    '/assets/rank/gold.png',
    '/assets/rank/platinum.png',
    '/assets/rank/diamond.png',
    '/assets/rank/star.png',
    '/assets/rank/king.png',
];

Page({
    data: {
        navTop: 72,
        ready: false,
        me: { nick: '我', tierName: '未定级', streak: 0, todayDone: false },
        meIcon: '/assets/rank/none.png',
        rank: [],
        myRank: 0,
        flist: [],
        friendCount: 0,
        hasFriends: false,
        quota: 0,
        friendNotify: true,
        subsCount: 0,
    },

    onLoad(options) {
        this.setData({ navTop: getNavTop() });
        this._inviteToken = options && options.invite ? String(options.invite) : '';
    },

    onShow() {
        subscribe.preload();
        this.refresh();
    },

    refresh() {
        const cfg = cloud.readConfig();
        if (!cfg.enabled || !cfg.token) {
            this.setData({ ready: false });
            return Promise.resolve();
        }
        const that = this;
        return cloud.call('/api/friends', 'GET')
            .then(function (res) {
                const me = res.me || {};
                const list = (res.friends || []).sort(function (a, b) {
                    return b.weekDays - a.weekDays || b.streak - a.streak;
                });
                that.setData({
                    ready: true,
                    me: me,
                    meIcon: TIER_ICON_BY_LEVEL[me.tierLevel] || '/assets/rank/none.png',
                    flist: list,
                    friendCount: list.length,
                    hasFriends: list.length > 0,
                    quota: (res.quota && res.quota.friend) || 0,
                    subsCount: res.subsCount || 0,
                    friendNotify: res.settings ? res.settings.friendNotify !== false : true,
                });
                // 预先生成邀请码：分享接口是同步的，码必须提前在手
                that.ensureInvite();
                return that.acceptIfNeeded().then(function () {
                    return cloud.call('/api/friends/rank', 'GET');
                });
            })
            .then(function (rank) {
                if (!rank) {
                    return null;
                }
                that.setData({ rank: rank.list || [], myRank: rank.myRank || 0 });
                return null;
            })
            .catch(function (err) {
                that.setData({ ready: true });
                wx.showToast({ title: err.message || '加载失败', icon: 'none' });
            });
    },

    // 从邀请卡片进来时，登录后自动建立关系
    acceptIfNeeded() {
        const token = this._inviteToken;
        if (!token) {
            return Promise.resolve();
        }
        this._inviteToken = '';
        return cloud.call('/api/friends/accept', 'POST', { token: token })
            .then(function () {
                haptics.tap();
                wx.showToast({ title: '已添加好友', icon: 'success' });
                return null;
            })
            .catch(function (err) {
                wx.showToast({ title: err.message || '邀请已失效', icon: 'none' });
                return null;
            });
    },

    goMe() {
        haptics.tap();
        wx.switchTab({ url: '/pages/me/me' });
    },

    onToggleNotify(e) {
        const on = e.detail.value;
        const that = this;
        if (!on) {
            subscribe.setSettings({ friendNotify: false }).then(function () {
                haptics.tap();
                that.setData({ friendNotify: false });
            });
            return;
        }
        // 点击栈里同步弹窗，否则微信会拒绝
        subscribe.askSync('friend').then(function (r) {
            haptics.tap();
            that.setData({ friendNotify: true });
            if (r === 'reject') {
                wx.showToast({ title: '未授权，暂时收不到提醒', icon: 'none' });
            }
            that.refresh();
        });
    },

    // 榜单上的订阅：先授权攒一条额度（同步，必须在点击栈里），再写订阅关系
    onToggleSub(e) {
        const id = e.currentTarget.dataset.id;
        const wasOn = e.currentTarget.dataset.on === true || e.currentTarget.dataset.on === 'true';
        const on = !wasOn;
        const that = this;
        haptics.tap();

        if (on) {
            // 订阅只是「谁拉了通知我」，真正能不能收到还取决于额度
            subscribe.askSync('friend');
        }

        cloud.call('/api/friends/subscribe', 'POST', { friendId: id, on: on })
            .then(function (res) {
                const rank = that.data.rank.map(function (u) {
                    return u.id === id ? Object.assign({}, u, { subscribed: on }) : u;
                });
                that.setData({ rank: rank, subsCount: res.subsCount || 0 });
                wx.showToast({
                    title: on ? '已订阅，他拉了会通知你' : '已取消订阅',
                    icon: 'none',
                });
                return null;
            })
            .catch(function (err) {
                wx.showToast({ title: err.message || '操作失败', icon: 'none' });
            });
    },

    onShareTouch() {
        haptics.tap();
    },

    onShareAppMessage() {
        const token = this._shareToken || '';
        // 分享出去的同时备好下一次的码，避免连着分享两次拿到同一个（一次性）
        this._shareToken = '';
        this.ensureInvite();
        return {
            title: '拉了么 · 来看看我们谁更能坚持',
            path: '/pages/friends/friends' + (token ? '?invite=' + token : ''),
        };
    },

    // 分享前生成一次性邀请码，收到卡片的人点进来就能直接建立关系
    ensureInvite() {
        if (this._shareToken) {
            return Promise.resolve(this._shareToken);
        }
        return cloud.call('/api/friends/invite', 'POST', {}).then(function (res) {
            this._shareToken = res.token;
            return res.token;
        }.bind(this)).catch(function () {
            return null;
        });
    },
});
