const { BRISTOL, streakDays, achievements } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');

const store = createRecordStore();

const ACH_LIST = [
    { id: 'week', name: '七日全勤', desc: '连续记录 7 天' },
    { id: 'flash', name: '闪电侠', desc: '单次用时 ≤ 3 分钟' },
    { id: 'marathon', name: '马拉松选手', desc: '单次用时 ≥ 20 分钟' },
    { id: 'collector', name: '收藏家', desc: '集齐布里斯托 1-7 型' },
];

Page({
    data: {
        period: 'week',
        countText: '0',
        avgText: '-',
        streakText: '0',
        dist: [],
        achList: ACH_LIST.map(function (a) {
            return { id: a.id, name: a.name, desc: a.desc, got: false };
        }),
        hasDist: false,
    },

    onShow() {
        this.render(this.data.period);
    },

    setPeriod(event) {
        const period = event.currentTarget.dataset.period;
        this.render(period);
    },

    onShareAppMessage() {
        const streak = parseInt(this.data.streakText, 10) || 0;
        const month = parseInt(this.data.countText, 10) || 0;
        return {
            title: '我近 7 天拉了 ' + month + ' 次，最长连续 ' + streak + ' 天，敢来比比吗？「拉了么」',
            path: '/pages/index/index?challenge=1&streak=' + streak + '&month=' + month,
        };
    },

    render(period) {
        const that = this;
        store.list().then(function (res) {
            if (res.error) {
                wx.showToast({ title: '读取失败，请重试', icon: 'none' });
                return;
            }
            const records = res.data;
            const days = period === 'week' ? 7 : 30;
            const start = Date.now() - days * 24 * 3600 * 1000;
            const list = records.filter(function (r) { return r.timestamp >= start; });

            let avgText = '-';
            if (list.length > 0) {
                let total = 0;
                list.forEach(function (r) { total += r.durationMin; });
                avgText = Math.round(total / list.length) + ' 分';
            }

            const counts = {};
            let distTotal = 0;
            list.forEach(function (r) {
                if (r.bristol) {
                    counts[r.bristol] = (counts[r.bristol] || 0) + 1;
                    distTotal += 1;
                }
            });
            const dist = [];
            BRISTOL.forEach(function (b) {
                const c = counts[b.t] || 0;
                if (!c) {
                    return;
                }
                dist.push({
                    label: b.t + ' ' + b.name,
                    pct: Math.round(c / distTotal * 100),
                    level: b.level,
                });
            });

            const got = achievements(records);
            const achList = ACH_LIST.map(function (a) {
                return {
                    id: a.id,
                    name: a.name,
                    desc: got[a.id] ? '已达成' : a.desc,
                    got: got[a.id],
                };
            });

            that.setData({
                period: period,
                countText: String(list.length),
                avgText: avgText,
                streakText: String(streakDays(records)),
                dist: dist,
                hasDist: dist.length > 0,
                achList: achList,
            });
        });
    },
});
