const { BRISTOL, BADGES, streakDays, dayStr } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const haptics = require('../../utils/haptics.js');
const share = require('../../utils/share.js');
const pk = require('../../utils/pk/api.js');
const rank = require('../../utils/rank.js');
const { getNavTop } = require('../../utils/nav.js');

const store = createRecordStore();

// 自定义范围默认：近 30 天
function defaultRange() {
    const end = new Date();
    const start = new Date(Date.now() - 29 * 24 * 3600 * 1000);
    return { start: dayStr(start.getTime()), end: dayStr(end.getTime()) };
}

function dateToMs(dateStr, endOfDay) {
    const parts = String(dateStr).split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (endOfDay) {
        return new Date(y, m, d, 23, 59, 59, 999).getTime();
    }
    return new Date(y, m, d, 0, 0, 0, 0).getTime();
}

Page({
    data: {
        period: 'week', // week | month | custom
        rangeStart: '',
        rangeEnd: '',
        rangeLabel: '',
        countText: '0',
        avgText: '-',
        avgNum: '',
        avgFallback: '-',
        streakText: '0',
        dist: [],
        achList: BADGES.map(function (b) {
            return { id: b.id, name: b.name, desc: b.desc, icon: b.iconOff, got: false };
        }),
        gotCount: 0,
        hasDist: false,
        navTop: 72,
        pkOn: false,
        pkFriends: 0,
        pkEntryLine: '和朋友比比谁更顺',
        friendsLine: '开启云同步后可添加好友',
        rankName: '未定级',
        rankDays: 0,
        rankPct: 0,
        rankNextLine: '',
        rankHint: '',
        rankSub: '',
        rankIcon: '/assets/rank/none.png',
        rankPeakName: '—',
        rankTicks: [],
    },

    onLoad() {
        this.setData({ navTop: getNavTop() });
    },

    onShow() {
        syncTabBar(this, 1);
        const that = this;
        store.list().then(function (res) {
            if (!res.error) {
                that._shareStats = share.makeStats(res.data);
                share.ensurePoster(that, that._shareStats);
            }
        });
        this.render(this.data.period);
        this.syncPkEntry();
        this.syncFriendsLine();
    },

    // 入口只显示状态，具体对比在 PK 页拉
    syncFriendsLine() {
        const cfg = require('../../utils/cloud.js').readConfig();
        this.setData({
            friendsLine: cfg.enabled && cfg.token
                ? '看看谁今天已经拉了'
                : '开启云同步后可添加好友',
        });
    },

    syncPkEntry() {
        const that = this;
        pk.getMode().then(function (on) {
            that.setData({ pkOn: !!on });
            if (!on) {
                that.setData({ pkEntryLine: '和朋友比比谁更顺' });
                return null;
            }
            return pk.listFriends();
        }).then(function (list) {
            if (!list) {
                return;
            }
            that.setData({
                pkFriends: list.length,
                pkEntryLine: list.length
                    ? list.length + ' 位好友 · 互见次数、时长、质量'
                    : '已开启，等第一位好友进来',
            });
        }).catch(function () {});
    },

    openFriends() {
        haptics.tap();
        wx.navigateTo({ url: '/pages/friends/friends' });
    },

    openPk() {
        haptics.tap();
        wx.navigateTo({ url: '/pages/pk/pk' });
    },

    onReady() {
        if (this._shareStats) {
            share.ensurePoster(this, this._shareStats);
        }
    },

    onShareAppMessage() {
        share.trackShare();
        // 从段位页发出的分享，带的是段位战报 + 挑战邀请
        const info = {
            title: '我连续 ' + (this.data.rankDays || 0) + ' 天，段位「' + (this.data.rankName || '未定级') + '」，敢来挑战吗',
            path: '/pages/index/index?challenge=1&streak=' + (this.data.rankDays || 0)
                + '&month=' + ((this._shareStats && this._shareStats.monthDays) || 0),
        };
        const poster = share.getPosterPath();
        if (poster) {
            info.imageUrl = poster;
        }
        return info;
    },

    // 分享按钮按下即震（主操作，双段强调）
    onShareTouch() {
        haptics.tap();
    },

    setPeriod(event) {
        const period = event.currentTarget.dataset.period;
        if (period === this.data.period) {
            return;
        }
        haptics.tap();
        if (period === 'custom' && !this.data.rangeStart) {
            const range = defaultRange();
            this.setData({ rangeStart: range.start, rangeEnd: range.end });
        }
        this.render(period);
    },

    onRangeStart(event) {
        haptics.light();
        this.setData({ rangeStart: event.detail.value });
        this.render('custom');
    },

    onRangeEnd(event) {
        haptics.light();
        this.setData({ rangeEnd: event.detail.value });
        this.render('custom');
    },

    onBadgeTap(event) {
        haptics.tap();
        const id = event.currentTarget.dataset.id;
        const item = this.data.achList.filter(function (a) { return a.id === id; })[0];
        if (!item) {
            return;
        }
        wx.showToast({
            title: item.got ? '已点亮 · ' + item.name : item.desc,
            icon: 'none',
            duration: 1800,
        });
    },

    render(period) {
        const that = this;
        const seq = (this._seq || 0) + 1;
        this._seq = seq;
        store.list().then(function (res) {
            if (res.error) {
                wx.showToast({ title: '读取失败，请重试', icon: 'none' });
                return;
            }
            const records = res.data;
            // 段位：统计页与首页共用同一份结算结果
            const rk = rank.sync(records);
            let list;
            let rangeLabel = '';
            if (period === 'week') {
                list = withinDays(records, 7);
            } else if (period === 'month') {
                list = withinDays(records, 30);
            } else {
                let start = that.data.rangeStart;
                let end = that.data.rangeEnd;
                // 起止颠倒时自动交换
                if (start && end && start > end) {
                    const t = start;
                    start = end;
                    end = t;
                    that.setData({ rangeStart: start, rangeEnd: end });
                }
                const s = start ? dateToMs(start, false) : 0;
                const e = end ? dateToMs(end, true) : Date.now();
                list = records.filter(function (r) { return r.timestamp >= s && r.timestamp <= e; });
                rangeLabel = '共 ' + (Math.max(0, Math.round((e - s) / 86400000)) + 1) + ' 天';
            }

            let avgText = '-';
            let avgNum = '';
            let avgFallback = '-';
            if (list.length > 0) {
                let total = 0;
                list.forEach(function (r) { total += r.durationMin; });
                const avg = Math.round(total / list.length);
                avgText = avg + ' 分';
                avgNum = String(avg);
                avgFallback = '';
            }

            const counts = {};
            let distTotal = 0;
            list.forEach(function (r) {
                if (r.bristol) {
                    counts[r.bristol] = (counts[r.bristol] || 0) + 1;
                    distTotal += 1;
                }
            });
            // key 带上本次渲染序号：节点会被重建，进度条 0→数值 的动画才能重播
            const barSeq = (that._barSeq || 0) + 1;
            that._barSeq = barSeq;
            const dist = [];
            BRISTOL.forEach(function (b) {
                const c = counts[b.t] || 0;
                if (!c) {
                    return;
                }
                dist.push({
                    key: barSeq + '-' + b.t,
                    label: b.t + ' ' + b.name,
                    pct: Math.round(c / distTotal * 100),
                    level: b.level,
                });
            });

            const got = share.makeStats(records).badges;
            const gotMap = {};
            got.forEach(function (b) { gotMap[b.id] = b.on; });
            let gotCount = 0;
            const achList = BADGES.map(function (b) {
                const on = !!gotMap[b.id];
                if (on) {
                    gotCount += 1;
                }
                return {
                    id: b.id,
                    name: b.name,
                    // 点亮与否已经由卡片面色与图标表达，副标题始终说明达成条件
                    desc: b.desc,
                    icon: on ? b.iconOn : b.iconOff,
                    got: on,
                };
            });

            if (that._seq !== seq) {
                return; // 已被更新的渲染覆盖
            }
            that.setData({
                period: period,
                rangeLabel: rangeLabel,
                countText: String(list.length),
                avgText: avgText,
                avgNum: avgNum,
                avgFallback: avgFallback,
                streakText: String(streakDays(records)),
                dist: dist,
                hasDist: dist.length > 0,
                achList: achList,
                gotCount: gotCount,
                rankName: rk.name,
                rankDays: rk.days,
                rankPct: rk.pct,
                rankNextLine: rk.nextLine,
                rankHint: rk.hint,
                rankSub: rk.days > 0 ? '连续 ' + rk.days + ' 天' : '还没有记录，先记一次',
                rankIcon: rk.icon,
                rankPeakName: rk.peak > rk.level ? rk.peakName : '',
                rankTicks: rk.ticks,
            });
        });
    },
});

function withinDays(records, days) {
    const start = Date.now() - days * 24 * 3600 * 1000;
    return records.filter(function (r) { return r.timestamp >= start; });
}

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
