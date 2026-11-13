const { BRISTOL, streakDays, achievements, dayStr, todayStr, pad2 } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const share = require('../../utils/share.js');

const store = createRecordStore();

const ACH_LIST = [
    { id: 'week', name: '七日全勤', desc: '连续记录 7 天' },
    { id: 'flash', name: '闪电侠', desc: '单次用时 ≤ 3 分钟' },
    { id: 'marathon', name: '马拉松选手', desc: '单次用时 ≥ 20 分钟' },
    { id: 'collector', name: '收藏家', desc: '集齐布里斯托 1-7 型' },
];

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
        streakText: '0',
        dist: [],
        achList: ACH_LIST.map(function (a) {
            return { id: a.id, name: a.name, desc: a.desc, got: false };
        }),
        hasDist: false,
    },

    onShow() {
        const that = this;
        store.list().then(function (res) {
            if (!res.error) {
                that._shareStats = {
                    streak: streakDays(res.data),
                    monthDays: monthDays(res.data),
                };
                share.ensurePoster(that, that._shareStats);
            }
        });
        this.render(this.data.period);
    },

    onShareAppMessage() {
        return share.makeShareInfo(this._shareStats);
    },

    setPeriod(event) {
        const period = event.currentTarget.dataset.period;
        if (period === 'custom' && !this.data.rangeStart) {
            const range = defaultRange();
            this.setData({ rangeStart: range.start, rangeEnd: range.end });
        }
        this.render(period);
    },

    onRangeStart(event) {
        this.setData({ rangeStart: event.detail.value });
        this.render('custom');
    },

    onRangeEnd(event) {
        this.setData({ rangeEnd: event.detail.value });
        this.render('custom');
    },

    render(period) {
        const that = this;
        store.list().then(function (res) {
            if (res.error) {
                wx.showToast({ title: '读取失败，请重试', icon: 'none' });
                return;
            }
            const records = res.data;
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
                rangeLabel: rangeLabel,
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

function withinDays(records, days) {
    const start = Date.now() - days * 24 * 3600 * 1000;
    return records.filter(function (r) { return r.timestamp >= start; });
}

// 本月打卡天数（与首页日历口径一致）
function monthDays(records) {
    const now = new Date();
    const prefix = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-';
    const seen = {};
    records.forEach(function (r) {
        const s = dayStr(r.timestamp);
        if (s.indexOf(prefix) === 0) {
            seen[s] = true;
        }
    });
    return Object.keys(seen).length;
}
