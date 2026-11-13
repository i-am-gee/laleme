const { dayStr, todayStr, fmtTime, fmtDur, bristolLabel, MOOD_TEXT } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');

const store = createRecordStore();

Page({
    data: {
        groups: [],
        empty: false,
    },

    onShow() {
        this.refresh();
    },

    refresh() {
        const that = this;
        store.list().then(function (res) {
            if (res.error) {
                wx.showToast({ title: '读取失败，请重试', icon: 'none' });
                return;
            }
            const records = res.data;
            const groups = [];
            let lastDay = '';
            records.forEach(function (r) {
                const day = dayStr(r.timestamp);
                if (day !== lastDay) {
                    lastDay = day;
                    groups.push({ day: day === todayStr() ? '今天' : day, items: [] });
                }
                groups[groups.length - 1].items.push({
                    id: r.id,
                    time: fmtTime(r.timestamp),
                    detail: fmtDur(r.durationMin) + ' · ' + bristolLabel(r.bristol) + (r.mood ? ' · ' + MOOD_TEXT[r.mood] : ''),
                });
            });
            that.setData({ groups: groups, empty: records.length === 0 });
        });
    },

    editItem(event) {
        const id = event.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/record/record?id=' + id });
    },
});
