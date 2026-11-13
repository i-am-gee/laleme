const { BRISTOL, CHEERS, pad2, pickRecord } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const haptics = require('../../utils/haptics.js');

const store = createRecordStore();

function dateValueOf(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function timeValueOf(ms) {
    const d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

Page({
    data: {
        isEdit: false,
        timerText: '00:00',
        timerState: '计时中',
        dateValue: '',
        timeValue: '',
        manualMin: '',
        bristolOptions: [],
        bristolHint: '',
        moodOptions: [
            { key: 'good', text: '通畅', sel: false },
            { key: 'normal', text: '一般', sel: false },
            { key: 'hard', text: '费劲', sel: false },
        ],
    },

    onLoad(options) {
        this.editId = options && options.id ? String(options.id) : null;
        this.timerSec = 0;
        this.timerInt = null;
        this.selBristol = null;
        this.selMood = null;

        const options2 = BRISTOL.map(function (b) {
            return {
                t: b.t,
                name: b.name,
                ideal: b.t === 4,
                sel: false,
            };
        });
        options2.push({ t: 0, name: '不确定', ideal: false, sel: false });
        this.setData({ bristolOptions: options2 });

        const that = this;
        store.list().then(function (res) {
            let records = res.data || [];
            if (that.editId) {
                const rec = pickRecord(that.editId, records);
                if (!rec) {
                    wx.showToast({ title: '记录不存在', icon: 'none' });
                    setTimeout(function () { wx.navigateBack(); }, 800);
                    return;
                }
                that.selBristol = rec.bristol;
                that.selMood = rec.mood;
                const ms = rec.timestamp;
                const moodOptions = that.data.moodOptions.map(function (m) {
                    return { key: m.key, text: m.text, sel: m.key === rec.mood };
                });
                const bristolOptions = that.data.bristolOptions.map(function (b) {
                    return {
                        t: b.t,
                        name: b.name,
                        ideal: b.ideal,
                        sel: b.t === 0 ? rec.bristol === null : rec.bristol === b.t,
                    };
                });
                that.setData({
                    isEdit: true,
                    manualMin: String(rec.durationMin),
                    dateValue: dateValueOf(ms),
                    timeValue: timeValueOf(ms),
                    moodOptions: moodOptions,
                    bristolOptions: bristolOptions,
                    bristolHint: rec.bristol ? BRISTOL[rec.bristol - 1].hint : '',
                });
                wx.setNavigationBarTitle({ title: '编辑记录' });
            } else {
                const now = Date.now();
                that.setData({
                    dateValue: dateValueOf(now),
                    timeValue: timeValueOf(now),
                });
                that.startTimer();
            }
        });
    },

    startTimer() {
        const that = this;
        this.timerInt = setInterval(function () {
            that.timerSec += 1;
            const m = Math.floor(that.timerSec / 60);
            const s = that.timerSec % 60;
            that.setData({
                timerText: pad2(m) + ':' + pad2(s),
            });
        }, 1000);
    },

    stopTimer() {
        if (this.timerInt) {
            clearInterval(this.timerInt);
            this.timerInt = null;
        }
    },

    onUnload() {
        this.stopTimer();
    },

    onHide() {
        this.stopTimer();
    },

    onManualMin(event) {
        this.setData({ manualMin: event.detail.value });
    },

    onDateChange(event) {
        haptics.light();
        this.setData({ dateValue: event.detail.value });
    },

    onTimeChange(event) {
        haptics.light();
        this.setData({ timeValue: event.detail.value });
    },

    pickBristol(event) {
        haptics.light();
        const t = Number(event.currentTarget.dataset.t);
        if (t === 0) {
            this.selBristol = null;
        } else {
            this.selBristol = t;
        }
        const that = this;
        const bristolOptions = this.data.bristolOptions.map(function (b) {
            return { t: b.t, name: b.name, ideal: b.ideal, sel: (t === 0 && b.t === 0) || b.t === t };
        });
        this.setData({
            bristolOptions: bristolOptions,
            bristolHint: t > 0 ? BRISTOL[t - 1].hint : '',
        });
    },

    pickMood(event) {
        haptics.light();
        const key = event.currentTarget.dataset.mood;
        this.selMood = key;
        const moodOptions = this.data.moodOptions.map(function (m) {
            return { key: m.key, text: m.text, sel: m.key === key };
        });
        this.setData({ moodOptions: moodOptions });
    },

    submit() {
        haptics.strong();
        const that = this;
        const manual = parseInt(this.data.manualMin, 10);
        let duration;
        if (!isNaN(manual) && manual > 0) {
            duration = Math.min(manual, 720);
        } else {
            duration = Math.max(1, Math.round(this.timerSec / 60));
        }
        const dateStr = this.data.dateValue;
        const timeStr = this.data.timeValue;
        const parts = dateStr.split('-');
        const timeParts = timeStr.split(':');
        const ts = new Date(
            Number(parts[0]),
            Number(parts[1]) - 1,
            Number(parts[2]),
            Number(timeParts[0]),
            Number(timeParts[1])
        ).getTime();

        const payload = {
            timestamp: ts,
            durationMin: duration,
            bristol: this.selBristol,
            mood: this.selMood,
        };

        const done = function () {
            that.stopTimer();
            wx.navigateBack();
        };

        if (this.editId) {
            store.update(this.editId, payload).then(function (res) {
                if (res.error) {
                    wx.showToast({ title: res.error.message || '保存失败', icon: 'none' });
                    return;
                }
                wx.showToast({ title: '记录已更新', icon: 'success' });
                done();
            });
        } else {
            store.create(payload).then(function (res) {
                if (res.error) {
                    wx.showToast({ title: res.error.message || '保存失败', icon: 'none' });
                    return;
                }
                const cheer = CHEERS[Math.floor(Math.random() * CHEERS.length)];
                const hint = that.selBristol ? BRISTOL[that.selBristol - 1].hint : '';
                wx.setStorageSync('laleme_celebrate_flag', Date.now());
                wx.showToast({ title: cheer, icon: 'success' });
                if (hint) {
                    setTimeout(function () {
                        wx.showToast({ title: hint, icon: 'none', duration: 2500 });
                    }, 1200);
                }
                done();
            });
        }
    },

    removeThis() {
        haptics.strong();
        const that = this;
        const id = this.editId;
        wx.showModal({
            title: '删除这条记录',
            content: '删除后无法恢复。',
            confirmText: '删除',
            confirmColor: '#e24b4a',
            success(res) {
                if (!res.confirm) {
                    return;
                }
                store.remove(id).then(function (r2) {
                    if (r2.error) {
                        wx.showToast({ title: r2.error.message || '删除失败', icon: 'none' });
                        return;
                    }
                    wx.showToast({ title: '已删除', icon: 'success' });
                    setTimeout(function () { wx.navigateBack(); }, 600);
                });
            },
        });
    },
});
