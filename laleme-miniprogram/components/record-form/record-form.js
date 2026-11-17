// 记录表单：首页底部抽屉与编辑页共用同一套逻辑
// 计时以「开始时间戳」为基准换算，切后台再回来不会漏算（v1.5 修复）
const { BRISTOL, CHEERS, pad2, pickRecord, POOP_COLORS, MOOD_ICONS } = require('../../utils/constants.js');
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

// 4 型（理想）排第一位：它是最常选的一档，放首屏第一格能少找一次
const BRISTOL_ORDER = [4, 1, 2, 3, 5, 6, 7];

// picked：是否真的选过。「不确定」在值为 null 时会被误显示成选中，必填场景必须区分
function bristolOptions(selected, picked) {
    const list = BRISTOL_ORDER.map(function (t) {
        const b = BRISTOL[t - 1];
        return { t: b.t, name: b.name, icon: b.icon, ideal: b.t === 4, sel: selected === b.t };
    });
    list.push({
        t: 0,
        name: '不确定',
        icon: '',
        ideal: false,
        sel: !!picked && (selected === null || selected === undefined),
    });
    return list;
}

// 颜色的提示语：只有少数几档需要提醒，其余留空
function colorHintOf(key) {
    const hit = POOP_COLORS.filter(function (c) { return c.key === key; })[0];
    return hit ? hit.hint : '';
}

function colorOptions(selected) {
    return POOP_COLORS.map(function (c) {
        return { key: c.key, name: c.name, hex: c.hex, sel: selected === c.key };
    });
}

function moodOptions(selected) {
    return [
        { key: 'good', text: '通畅', icon: MOOD_ICONS.good, sel: selected === 'good' },
        { key: 'normal', text: '一般', icon: MOOD_ICONS.normal, sel: selected === 'normal' },
        { key: 'hard', text: '费劲', icon: MOOD_ICONS.hard, sel: selected === 'hard' },
    ];
}


// 时长拉霸：0 位留给「计时中」，之后逐分钟，到 60 分钟为止
const MINUTE_STEPS = (function () {
    const list = [];
    for (let m = 1; m <= 60; m += 1) list.push(m);
    return list;
})();

const DURATION_DEFAULT = 5;
const DUR_ITEM_RPX = 88;   // 一行高度，与 wxss 的 .dur-row 保持一致
const DUR_WHEEL_RPX = 360; // 滚轮可视高度，与 wxss 的 .dur-wheel 一致

function durationOptions(isEdit) {
    const list = isEdit ? [] : [{ value: 0, label: '计时中' }];
    MINUTE_STEPS.forEach(function (m) {
        list.push({ value: m, label: m + ' 分钟' });
    });
    return list;
}

// 编辑态的时长可能不在步进里（比如 63 分钟），插进有序列表，别让拉霸错位
function withValue(list, value) {
    if (!(value > 0)) {
        return list;
    }
    const exists = list.some(function (o) { return o.value === value; });
    if (exists) {
        return list;
    }
    const out = list.slice();
    let pos = out.length;
    for (let i = 0; i < out.length; i += 1) {
        if (out[i].value > value) {
            pos = i;
            break;
        }
    }
    out.splice(pos, 0, { value: value, label: value + ' 分钟' });
    return out;
}

function indexOfValue(list, value) {
    for (let i = 0; i < list.length; i += 1) {
        if (list[i].value === value) {
            return i;
        }
    }
    return 0;
}

Component({
    properties: {
        // 传入则为编辑模式
        recordId: { type: String, value: '' },
        // 首页浮层底下压着自定义 tabBar，时长面板要给人家让出位置
        tabbarSpace: { type: Boolean, value: false },
    },

    data: {
        isEdit: false,
        timerText: '00:00',
        dateValue: '',
        timeValue: '',
        manualMin: '',
        durationLabel: '计时中',
        durationHint: '点一下手动指定时长',
        manualText: '',
        bristolWarn: false,
        colorWarn: false,
        moodWarn: false,
        durOpen: false,
        durOptions: [],
        durOffset: 0,
        durMoving: false,
        durActive: 0,
        bristolOptions: bristolOptions(null),
        bristolHint: '',
        colorOptions: colorOptions(null),
        colorHint: '',
        moodOptions: moodOptions(null),
    },

    lifetimes: {
        created() {
            this.selBristol = null;
            this.selMood = null;
            this.selColor = null;
            this.bristolPicked = false;
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
                color: this.selColor,
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
                this.selColor = draft.color === undefined ? null : draft.color;
                this.bristolPicked = draft.bristol !== undefined;
                this.setData({
                    bristolOptions: bristolOptions(this.selBristol, this.bristolPicked),
                    bristolHint: this.selBristol ? BRISTOL[this.selBristol - 1].hint : '',
                    colorOptions: colorOptions(this.selColor),
                    colorHint: colorHintOf(this.selColor),
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
                that.selColor = last.color === undefined ? null : last.color;
                that.bristolPicked = last.bristol !== undefined;
                that.setData({
                    bristolOptions: bristolOptions(that.selBristol, that.bristolPicked),
                    bristolHint: that.selBristol ? BRISTOL[that.selBristol - 1].hint : '',
                    colorOptions: colorOptions(that.selColor),
                    colorHint: colorHintOf(that.selColor),
                    moodOptions: moodOptions(that.selMood),
                });
            });
        },

        open() {
            const that = this;
            const now = Date.now();
            this.selBristol = null;
            this.selMood = null;
            this.selColor = null;
            this.bristolPicked = false;
            this.setData({
                isEdit: false,
                manualMin: '',
                dateValue: dateValueOf(now),
                timeValue: timeValueOf(now),
                bristolOptions: bristolOptions(null, false),
                bristolHint: '',
                colorOptions: colorOptions(null),
                colorHint: '',
                moodOptions: moodOptions(null),
                timerText: '00:00',
                durOpen: false,
            });
            this.updateDurationLabel();

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
                that.bristolPicked = true;
                that.selBristol = rec.bristol;
                that.selMood = rec.mood;
                that.selColor = rec.color === undefined ? null : rec.color;
                that.setData({
                    isEdit: true,
                    manualMin: String(rec.durationMin),
                    dateValue: dateValueOf(rec.timestamp),
                    timeValue: timeValueOf(rec.timestamp),
                    bristolOptions: bristolOptions(rec.bristol, true),
                    bristolHint: rec.bristol ? BRISTOL[rec.bristol - 1].hint : '',
                    colorOptions: colorOptions(rec.color === undefined ? null : rec.color),
                    colorHint: colorHintOf(rec.color),
                    moodOptions: moodOptions(rec.mood),
                    durOpen: false,
                });
                that.updateDurationLabel();
            });
        },

        /* ---------- 交互 ---------- */
        /* ---------- 时长拉霸 ---------- */
        updateDurationLabel() {
            const min = parseInt(this.data.manualMin, 10);
            const has = !isNaN(min) && min > 0;
            let hint;
            if (this.data.isEdit) {
                hint = '点一下改时长';
            } else if (has) {
                hint = '已手动指定 ' + min + ' 分钟 · 点一下修改';
            } else {
                hint = '点一下数字手动指定时长';
            }
            this.setData({
                durationLabel: has ? min + ' 分钟' : '计时中',
                durationHint: hint,
                manualText: has ? this.formatMin(min) : '',
            });
        },

        // 时长按计时器同样的 mm:ss 展示，手动指定时用它顶替计时位置
        formatMin(min) {
            return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
        },

        openDuration() {
            haptics.light();
            const isEdit = this.data.isEdit;
            const cur = parseInt(this.data.manualMin, 10);
            const target = (!isNaN(cur) && cur > 0) ? cur : DURATION_DEFAULT;
            const list = withValue(durationOptions(isEdit), target);
            const index = indexOfValue(list, target);
            this._wheelTimers = this._wheelTimers || [];
            this._itemH = this.rpxToPx(DUR_ITEM_RPX);
            this._wheelH = this.rpxToPx(DUR_WHEEL_RPX);
            // 轨道偏移：让第 index 行正好落在中间
            this._half = (this._wheelH - this._itemH) / 2;
            this._maxOffset = this._half - (list.length - 1) * this._itemH;
            this._offset = this.offsetOf(index);
            this._durIndex = index;
            this.setData({
                durOpen: true,
                durOptions: list,
                durActive: index,
                durOffset: this._offset,
                durMoving: false,
            });
        },

        // rpx → px：transform 只认 px
        rpxToPx(rpx) {
            const info = wx.getSystemInfoSync();
            return (info.windowWidth || 375) / 750 * rpx;
        },

        offsetOf(index) {
            return this._half - index * this._itemH;
        },

        indexOfOffset(offset) {
            const max = (this.data.durOptions || []).length - 1;
            const i = Math.round((this._half - offset) / this._itemH);
            return Math.max(0, Math.min(max, i));
        },

        /* ---------- 滚轮：自己算位移，不再依赖 scroll-view 的惯性 ---------- */
        onWheelStart(event) {
            this.cancelWheelAnim();
            const y = event.touches[0].clientY;
            this._dragY = y;
            this._dragOffset = this._offset;
            this._lastY = y;
            this._lastT = Date.now();
            this._velocity = 0;
            this.setData({ durMoving: false });
        },

        onWheelMove(event) {
            const y = event.touches[0].clientY;
            let offset = this._dragOffset + (y - this._dragY);
            offset = Math.max(this._maxOffset, Math.min(this._half, offset));
            const now = Date.now();
            const dt = now - this._lastT;
            if (dt > 0) {
                // 记录瞬时速度，抬手时用它做惯性投影
                this._velocity = (y - this._lastY) / dt;
                this._lastY = y;
                this._lastT = now;
            }
            this._offset = offset;
            const idx = this.indexOfOffset(offset);
            if (idx !== this.data.durActive) {
                haptics.light();
                this._lastPaint = offset;
                this.setData({ durOffset: offset, durActive: idx });
                return;
            }
            // 位移没超过半像素就不必惊动 setData
            if (Math.abs(offset - (this._lastPaint || 0)) < 0.5) {
                return;
            }
            this._lastPaint = offset;
            this.setData({ durOffset: offset });
        },

        onWheelEnd() {
            // 惯性投影：按抬手速度往前推一段，再吸附到整行
            const v = Math.max(-1.4, Math.min(1.4, this._velocity || 0));
            const projected = this._offset + v * 160;
            const idx = this.indexOfOffset(
                Math.max(this._maxOffset, Math.min(this._half, projected))
            );
            this.settleTo(idx);
        },

        onDurRowTap(event) {
            const i = Number(event.currentTarget.dataset.index);
            if (isNaN(i)) {
                return;
            }
            haptics.light();
            this.settleTo(i);
        },

        // 带过渡地滑到第 i 行，跨过的每一个数字都补一下震动
        settleTo(index) {
            const from = this.data.durActive;
            const target = this.offsetOf(index);
            const dist = Math.abs(target - this._offset);
            if (dist < 0.5) {
                return;
            }
            const duration = 300; // 与 .dur-track.moving 的过渡时长保持一致
            this._offset = target;
            this._durIndex = index;
            this.cancelWheelAnim();
            this.setData({ durMoving: true, durOffset: target, durActive: index });
            // 过渡期间按路程补震动（easeOut 近似：跨行时间靠前）
            const steps = Math.abs(index - from);
            if (steps > 0) {
                const dir = index > from ? 1 : -1;
                for (let k = 1; k <= steps; k += 1) {
                    const frac = k / (steps + 0.6);
                    const t = (1 - Math.pow(1 - frac, 1 / 3)) * duration;
                    this._wheelTimers.push(setTimeout(function () {
                        haptics.light();
                    }, t));
                }
            }
        },

        cancelWheelAnim() {
            (this._wheelTimers || []).forEach(function (t) {
                clearTimeout(t);
            });
            this._wheelTimers = [];
        },

        confirmDuration() {
            haptics.tap();
            const list = this.data.durOptions || [];
            const idx = typeof this._durIndex === 'number' ? this._durIndex : this.data.durActive;
            const opt = list[idx];
            const value = opt && opt.value > 0 ? opt.value : 0;
            const hasManual = value > 0;
            this.clearDurTimer();
            this.setData({ durOpen: false, manualMin: hasManual ? String(value) : '' });
            this.updateDurationLabel();
            // 手动指定之后就不再计时了：停表，位置改成显示指定时长
            if (!this.data.isEdit) {
                if (hasManual) {
                    this.stopTimer();
                    timer.stop();
                } else if (!timer.running()) {
                    this.startTimer();
                }
            }
        },

        closeDuration() {
            haptics.light();
            this.clearDurTimer();
            this.setData({ durOpen: false });
        },

        clearDurTimer() {
            this.cancelWheelAnim();
        },

        // 拉霸打开时挡住底层滚动
        stopTouch() {},

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
            this.bristolPicked = true;
            this.setData({
                bristolOptions: bristolOptions(this.selBristol, true),
                bristolHint: t > 0 ? BRISTOL[t - 1].hint : '',
                bristolWarn: false,
            });
            this.saveDraft();
        },

        pickColor(event) {
            haptics.light();
            const key = event.currentTarget.dataset.color;
            // 颜色是必填项，再点同一档不再取消，只做选中
            this.selColor = key;
            this.setData({
                colorOptions: colorOptions(this.selColor),
                colorHint: colorHintOf(this.selColor),
                colorWarn: false,
            });
            this.saveDraft();
        },

        pickMood(event) {
            haptics.light();
            const key = event.currentTarget.dataset.mood;
            this.selMood = key;
            this.setData({ moodOptions: moodOptions(key), moodWarn: false });
            this.saveDraft();
        },

        submit() {
            haptics.tap();
            // 形状 / 颜色 / 感受都是必填：缺哪个就把哪个标红并提示
            const missing = [];
            if (!this.bristolPicked) {
                missing.push('形状');
            }
            if (this.selColor === null || this.selColor === undefined) {
                missing.push('颜色');
            }
            if (!this.selMood) {
                missing.push('感受');
            }
            if (missing.length) {
                this.setData({
                    bristolWarn: !this.bristolPicked,
                    colorWarn: this.selColor === null || this.selColor === undefined,
                    moodWarn: !this.selMood,
                });
                wx.showToast({ title: '请选择' + missing[0], icon: 'none' });
                return;
            }

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
                color: this.selColor,
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
