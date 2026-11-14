// 记录表单：首页底部抽屉与编辑页共用同一套逻辑
// 计时以「开始时间戳」为基准换算，切后台再回来不会漏算（v1.5 修复）
const { BRISTOL, CHEERS, pad2, pickRecord } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const haptics = require('../../utils/haptics.js');
const timer = require('../../utils/timer.js');

const store = createRecordStore();

// 未保存的选择存个草稿：关掉浮层、去别的页面逛一圈，回来还是原来的选择
const DRAFT_KEY = 'laleme_draft';
const DRAFT_TTL = 24 * 60 * 60 * 1000;

function dateValueOf(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function timeValueOf(ms) {
    const d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function bristolOptions(selected) {
    const list = BRISTOL.map(function (b) {
        return { t: b.t, name: b.name, ideal: b.t === 4, sel: selected === b.t };
    });
    list.push({ t: 0, name: '不确定', ideal: false, sel: selected === null || selected === undefined });
    return list;
}

function moodOptions(selected) {
    return [
        { key: 'good', text: '通畅', sel: selected === 'good' },
        { key: 'normal', text: '一般', sel: selected === 'normal' },
        { key: 'hard', text: '费劲', sel: selected === 'hard' },
    ];
}

Component({
    properties: {
        // 传入则为编辑模式
        recordId: { type: String, value: '' },
    },

    data: {
        isEdit: false,
        timerText: '00:00',
        dateValue: '',
        timeValue: '',
        manualMin: '',
        bristolOptions: bristolOptions(null),
        bristolHint: '',
        moodOptions: moodOptions(null),
    },

    lifetimes: {
        created() {
            this.selBristol = null;
            this.selMood = null;
            this._startAt = 0;
            this._timer = null;
        },
        detached() {
            this.stopTimer();
        },
    },

    // recordId 由父页面 onLoad 后才写入，必须用 observer 监听（attached 时还是空串）
    observers: {
        recordId(value) {
            if (value) {
                this.loadRecord(value);
            }
        },
    },

    methods: {
        /* ---------- 计时：以开始时间戳换算，不依赖 tick 次数 ---------- */
        startTimer() {
            this.stopTimer();
            // 计时状态存到全局，抽屉关掉、切页、切后台都不影响
            timer.start();
            this._startAt = Date.now();
            const that = this;
            this.setData({ timerText: '00:00' });
            this._timer = setInterval(function () {
                that.tick();
            }, 500);
        },

        tick() {
            if (!timer.running()) {
                return;
            }
            const text = timer.elapsedText();
            if (text !== this.data.timerText) {
                this.setData({ timerText: text });
            }
        },

        stopTimer() {
            if (this._timer) {
                clearInterval(this._timer);
                this._timer = null;
            }
        },

        // 回到前台时补一次，显示跳过的时长
        resume() {
            if (timer.running() && !this.data.isEdit && !this._timer) {
                const that = this;
                this._startAt = timer.startAt();
                this.tick();
                this._timer = setInterval(function () {
                    that.tick();
                }, 500);
            }
        },

        pause() {
            this.stopTimer();
        },

        /* ---------- 新建：由外部（首页抽屉）调用 ---------- */
        /* ---------- 草稿：保住没保存的选择 ---------- */
        readDraft() {
            const raw = wx.getStorageSync(DRAFT_KEY);
            if (!raw || typeof raw !== 'object') {
                return null;
            }
            if (!raw.savedAt || Date.now() - raw.savedAt > DRAFT_TTL) {
                wx.removeStorageSync(DRAFT_KEY);
                return null;
            }
            return raw;
        },

        saveDraft() {
            if (this.data.isEdit) {
                return;
            }
            wx.setStorageSync(DRAFT_KEY, {
                bristol: this.selBristol,
                mood: this.selMood,
                savedAt: Date.now(),
            });
        },

        clearDraft() {
            wx.removeStorageSync(DRAFT_KEY);
        },

        // 优先用草稿，其次沿用上一条记录；时长不参与，每次都由这次计时决定
        restoreSelection() {
            const that = this;
            const draft = this.readDraft();
            if (draft) {
                this.selBristol = draft.bristol === undefined ? null : draft.bristol;
                this.selMood = draft.mood === undefined ? null : draft.mood;
                this.setData({
                    bristolOptions: bristolOptions(this.selBristol),
                    bristolHint: this.selBristol ? BRISTOL[this.selBristol - 1].hint : '',
                    moodOptions: moodOptions(this.selMood),
                });
                return;
            }
            store.list().then(function (res) {
                const list = res.data || [];
                // readRecords 按时间倒序返回，第一条才是最近一次
                const last = list.length ? list[0] : null;
                if (!last) {
                    return;
                }
                that.selBristol = last.bristol === undefined ? null : last.bristol;
                that.selMood = last.mood === undefined ? null : last.mood;
                that.setData({
                    bristolOptions: bristolOptions(that.selBristol),
                    bristolHint: that.selBristol ? BRISTOL[that.selBristol - 1].hint : '',
                    moodOptions: moodOptions(that.selMood),
                });
            });
        },

        open() {
            const that = this;
            const now = Date.now();
            this.selBristol = null;
            this.selMood = null;
            this.setData({
                isEdit: false,
                manualMin: '',
                dateValue: dateValueOf(now),
                timeValue: timeValueOf(now),
                bristolOptions: bristolOptions(null),
                bristolHint: '',
                moodOptions: moodOptions(null),
                timerText: '00:00',
            });

            // 草稿优先，其次沿用上一次的性状与感受
            this.restoreSelection();

            // 已经有在跑的计时就接着走，不重新起算
            if (timer.running()) {
                this.resume();
            } else {
                this.startTimer();
            }
        },

        close() {
            this.stopTimer();
            this._startAt = 0;
        },

        loadRecord(id) {
            this.stopTimer();
            this._startAt = 0;
            const that = this;
            store.list().then(function (res) {
                const rec = pickRecord(id, res.data || []);
                if (!rec) {
                    wx.showToast({ title: '记录不存在', icon: 'none' });
                    that.triggerEvent('deleted');
                    return;
                }
                that.editId = rec.id;
                that.selBristol = rec.bristol;
                that.selMood = rec.mood;
                that.setData({
                    isEdit: true,
                    manualMin: String(rec.durationMin),
                    dateValue: dateValueOf(rec.timestamp),
                    timeValue: timeValueOf(rec.timestamp),
                    bristolOptions: bristolOptions(rec.bristol),
                    bristolHint: rec.bristol ? BRISTOL[rec.bristol - 1].hint : '',
                    moodOptions: moodOptions(rec.mood),
                });
            });
        },

        /* ---------- 交互 ---------- */
        onManualMin(event) {
            this.setData({ manualMin: event.detail.value });
            this.saveDraft();
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
            this.selBristol = t === 0 ? null : t;
            this.setData({
                bristolOptions: bristolOptions(this.selBristol),
                bristolHint: t > 0 ? BRISTOL[t - 1].hint : '',
            });
            this.saveDraft();
        },

        pickMood(event) {
            haptics.light();
            const key = event.currentTarget.dataset.mood;
            this.selMood = key;
            this.setData({ moodOptions: moodOptions(key) });
            this.saveDraft();
        },

        submit() {
            haptics.tap();
            const manual = parseInt(this.data.manualMin, 10);
            let duration;
            if (!isNaN(manual) && manual > 0) {
                duration = Math.min(manual, 720);
            } else if (timer.running()) {
                duration = timer.elapsedMin();
            } else {
                duration = 1;
            }

            const parts = String(this.data.dateValue).split('-');
            const timeParts = String(this.data.timeValue).split(':');
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

            const that = this;
            if (this.data.isEdit && this.editId) {
                store.update(this.editId, payload).then(function (res) {
                    if (res.error) {
                        wx.showToast({ title: res.error.message || '保存失败', icon: 'none' });
                        return;
                    }
                    wx.showToast({ title: '记录已更新', icon: 'success' });
                    that.stopTimer();
                    timer.stop();
                    that.clearDraft();
                    that.triggerEvent('saved', { mode: 'update' });
                });
                return;
            }

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
                that.stopTimer();
                timer.stop();
                that.clearDraft();
                that.triggerEvent('saved', { mode: 'create' });
            });
        },

        removeThis() {
            haptics.tap();
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
                        that.triggerEvent('deleted');
                    });
                },
            });
        },

        onCancel() {
            haptics.light();
            this.triggerEvent('cancel');
        },

        // 阻止滚动穿透
        noop() {},
    },
});
