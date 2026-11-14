const { fmtDT, fmtTime, fmtDur, bristolLabel, dayStr, todayStr, CHEERS, monthCalendar } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const haptics = require('../../utils/haptics.js');
const share = require('../../utils/share.js');
const { getNavTop } = require('../../utils/nav.js');

const store = createRecordStore();

const CONFETTI_COLORS = ['#f0997b', '#97c459', '#85b7eb', '#ed93b1', '#fac775', '#5dcaa5'];

const PRIVACY_SUMMARY = [
    '1. 你的打卡记录仅保存在本机（本地存储），不上传、不收集任何个人信息。',
    '2. 仅在你主动点击分享时，微信向你选择的好友发送打卡统计卡片。',
    '3. 全文见「用户隐私保护指引」，同意后即可使用。',
].join('\n');

// 彩屑：数量与时长比早些的版本更足，让庆祝有持续感
function buildConfetti() {
    const pieces = [];
    for (let i = 0; i < 24; i += 1) {
        pieces.push({
            left: Math.round(3 + Math.random() * 94),
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            delay: (Math.random() * 1.6).toFixed(2),
            duration: (1.9 + Math.random() * 1.9).toFixed(2),
            size: 10 + Math.round(Math.random() * 9),
            round: i % 3 === 0,
        });
    }
    return pieces;
}

Page({
    data: {
        statusClass: 'notyet',
        statusTitle: '拉了么？',
        statusSub: '今天还没拉',
        lastText: '还没有记录',
        lastTime: '还没有记录',
        lastDur: '',
        lastShape: '',
        streakText: '未开始',
        monthCountText: '0 次',
        challenge: null,
        calendar: null,
        fabPressed: false,
        sheetShow: false,
        showCelebrate: false,
        celebrateText: '',
        celebrateTitle: '打卡成功！',
        celebrateGrand: false,
        confetti: [],
        shareBadge: false,
        showPrivacy: false,
        privacySummary: PRIVACY_SUMMARY,
        privacyContractName: '《小程序隐私保护指引》',
        navTop: 72,
        monthOffset: 0,
        streakNum: '',
        monthCountNum: '0',
        streakFallback: '未开始',
    },

    onLoad(options) {
        this.setData({ navTop: getNavTop() });
        if (options && options.challenge === '1') {
            this.setData({
                challenge: {
                    streak: parseInt(options.streak, 10) || 0,
                    month: parseInt(options.month, 10) || 0,
                },
            });
        }
    },

    onShow() {
        syncTabBar(this, 0);
        this.refresh();
        this.maybeCelebrate();
        this.checkPrivacy();
        // 回到前台时把抽屉里的计时补上（切后台期间也计入）
        const form = this.selectComponent('#recordForm');
        if (form) {
            form.resume();
        }
    },

    onReady() {
        // 数据早于画布就绪时，补绘分享海报
        if (this._stats) {
            share.ensurePoster(this, this._stats);
        }
    },

    refresh() {
        const that = this;
        store.list().then(function (res) {
            if (res.error) {
                wx.showToast({ title: '读取失败，请重试', icon: 'none' });
                return;
            }
            const records = res.data;
            const today = records.filter(function (r) { return dayStr(r.timestamp) === todayStr(); });
            if (today.length > 0) {
                that.setData({
                    statusClass: 'done',
                    statusTitle: '拉过了',
                    statusSub: '今天已拉 ' + today.length + ' 次',
                });
            } else {
                that.setData({
                    statusClass: 'notyet',
                    statusTitle: '拉了么？',
                    statusSub: '今天还没拉',
                });
            }
            let lastText = '还没有记录';
            let lastTime = '还没有记录';
            let lastDur = '';
            let lastShape = '';
            if (records.length > 0) {
                let latest = records[0];
                for (let i = 1; i < records.length; i += 1) {
                    if (records[i].timestamp > latest.timestamp) {
                        latest = records[i];
                    }
                }
                const ld = new Date(latest.timestamp);
                // 当天只显示「今天 时:分」，省下的横向空间留给时长与性状
                lastTime = dayStr(latest.timestamp) === todayStr()
                    ? '今天 ' + fmtTime(latest.timestamp)
                    : (ld.getMonth() + 1) + '月' + ld.getDate() + '日 ' + fmtTime(latest.timestamp);
                lastDur = fmtDur(latest.durationMin);
                lastShape = bristolLabel(latest.bristol);
                lastText = lastTime + ' · ' + lastDur + ' · ' + lastShape;
            }
            const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
            const monthCount = records.filter(function (r) { return r.timestamp >= monthAgo; }).length;
            const stats = share.makeStats(records);
            that._stats = stats;
            const now = new Date();
            const WD = ['日', '一', '二', '三', '四', '五', '六'];
            const dateText = (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + WD[now.getDay()];
            // 日历默认停在当前月；切月由 shiftMonth 负责重算
            const monthBase = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            that._records = records;
            that.setData({
                lastText: lastText,
                lastTime: lastTime,
                lastDur: lastDur,
                lastShape: lastShape,
                streakText: stats.streak > 0 ? stats.streak + ' 天' : '未开始',
                streakNum: stats.streak > 0 ? String(stats.streak) : '',
                streakFallback: stats.streak > 0 ? '' : '未开始',
                monthCountText: monthCount + ' 次',
                monthCountNum: String(monthCount),
                dateText: dateText,
                todayCount: today.length,
                monthOffset: 0,
                calendar: monthCalendar(records, monthBase),
                shareBadge: share.shareBadge(),
            }, function () {
                share.ensurePoster(that, that._stats);
            });
        });
    },

    onShareAppMessage() {
        this.afterShare(share.trackShare());
        return share.makeShareInfo(this._stats);
    },

    // 分享被拉起后的本地记账；称号达成的标记由 share.trackShare 写入
    afterShare(result) {
        this.setData({ shareBadge: result.badge });
    },

    onShareTimeline() {
        const stats = this._stats || { streak: 0, monthDays: 0 };
        const streak = stats.streak || 0;
        const info = {
            title: '我在「拉了么」连续打卡 ' + streak + ' 天啦，你也来记录肠道健康！',
        };
        const path = share.getPosterPath();
        if (path) {
            info.imageUrl = path;
        }
        return info;
    },

    /* ---- 日历：点某天看当日明细 ---- */
    onDayTap(event) {
        const day = Number(event.currentTarget.dataset.day);
        const count = Number(event.currentTarget.dataset.count) || 0;
        if (!day) {
            return;
        }
        if (!count) {
            haptics.light();
            wx.showToast({ title: '这天没有记录', icon: 'none' });
            return;
        }
        haptics.tap();
        const cal = this.data.calendar;
        const target = cal.year + '-' + pad2(cal.monthIndex + 1) + '-' + pad2(day);
        const app = getApp();
        if (app && app.globalData) {
            app.globalData.historyTargetDay = target;
        }
        wx.switchTab({
            url: '/pages/history/history',
            fail: function () {
                wx.showToast({ title: '打开历史失败', icon: 'none' });
            },
        });
    },

    /* ---- 日历：左右滑动切换月份 ---- */
    onCalTouchStart(event) {
        const t = event.touches && event.touches[0];
        if (!t) {
            return;
        }
        this._calX = t.clientX;
        this._calY = t.clientY;
    },

    onCalTouchEnd(event) {
        if (this._calX === undefined) {
            return;
        }
        const t = event.changedTouches && event.changedTouches[0];
        const x0 = this._calX;
        const y0 = this._calY;
        this._calX = undefined;
        if (!t) {
            return;
        }
        const dx = t.clientX - x0;
        const dy = t.clientY - y0;
        // 横向位移足够，且明显大于纵向（避免和页面滚动打架）
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) {
            return;
        }
        if (dx < 0) {
            this.stepMonth(1);
        } else {
            this.stepMonth(-1);
        }
    },

    onMonthPrev() {
        this.stepMonth(-1);
    },

    onMonthNext() {
        this.stepMonth(1);
    },

    stepMonth(delta) {
        const next = this.data.monthOffset + delta;
        if (next > 0) {
            haptics.light();
            return; // 不进入未来月份
        }
        haptics.light();
        this.setData({ monthOffset: next });
        this.renderCalendar();
    },

    renderCalendar() {
        const now = new Date();
        const base = new Date(now.getFullYear(), now.getMonth() + this.data.monthOffset, 1);
        this.setData({ calendar: monthCalendar(this._records || [], base.getTime()) });
    },

    /* ---- 庆祝动画 ---- */
    maybeCelebrate() {
        // 称号优先：刚达成「大屎官」时先放这一场
        const badgeFlag = wx.getStorageSync('laleme_badge_flag');
        if (badgeFlag && Date.now() - Number(badgeFlag) < 60000) {
            wx.removeStorageSync('laleme_badge_flag');
            haptics.strong();
            this.playCelebrate(
                '大屎官',
                '连喊三次，实至名归。\n从此你的大便，闪金光。',
                true,
                4600
            );
            return;
        }
        const flag = wx.getStorageSync('laleme_celebrate_flag');
        if (flag && Date.now() - Number(flag) < 10000) {
            wx.removeStorageSync('laleme_celebrate_flag');
            haptics.tap();
            this.playCelebrate(
                '打卡成功！',
                CHEERS[Math.floor(Math.random() * CHEERS.length)],
                false,
                3200
            );
        }
    },

    playCelebrate(title, text, grand, duration) {
        const that = this;
        if (this._celebrateTimer) {
            clearTimeout(this._celebrateTimer);
            this._celebrateTimer = null;
        }
        this.setTabBarDim(true);
        this.setData({
            showCelebrate: true,
            celebrateTitle: title,
            celebrateText: text,
            celebrateGrand: !!grand,
            confetti: buildConfetti(),
        });
        this._celebrateTimer = setTimeout(function () {
            that.setData({ showCelebrate: false });
            that.setTabBarDim(false);
        }, duration || 3200);
    },

    // 自定义 tabBar 是独立节点，页面里的遮罩盖不住它，得单独通知它压暗
    setTabBarDim(dim) {
        if (typeof this.getTabBar !== 'function') {
            return;
        }
        const tab = this.getTabBar();
        if (tab && tab.data && tab.data.dim !== dim) {
            tab.setData({ dim: dim });
        }
    },

    hideCelebrate() {
        if (this._celebrateTimer) {
            clearTimeout(this._celebrateTimer);
            this._celebrateTimer = null;
        }
        this.setData({ showCelebrate: false });
        this.setTabBarDim(false);
    },

    /* ---- 隐私授权 ---- */
    checkPrivacy() {
        const that = this;
        if (wx.getStorageSync('laleme_privacy_agreed')) {
            this.resolvePendingPrivacy();
            return;
        }
        if (wx.getStorageSync('laleme_privacy_pending')) {
            wx.removeStorageSync('laleme_privacy_pending');
        }
        // 未同意时强制告知：不依赖平台 needAuthorization 开关，确保审核合规
        if (wx.getPrivacySetting) {
            wx.getPrivacySetting({
                success: function (res) {
                    that.setData({
                        showPrivacy: true,
                        privacyContractName: res.privacyContractName || '《小程序隐私保护指引》',
                    });
                },
                fail: function () {
                    that.setData({ showPrivacy: true });
                },
            });
        } else {
            this.setData({ showPrivacy: true });
        }
    },

    showPrivacyPopup() {
        this.setData({ showPrivacy: true });
    },

    onPrivacyAgree() {
        // bindagree（官方授权按钮回调）与 bindtap 双通道触发，这里做幂等保护
        if (!this.data.showPrivacy) return;
        haptics.tap();
        wx.setStorageSync('laleme_privacy_agreed', Date.now());
        this.setData({ showPrivacy: false });
        this.resolvePendingPrivacy();
    },

    resolvePendingPrivacy() {
        const app = getApp();
        if (app && app.globalData.privacyResolve) {
            const resolve = app.globalData.privacyResolve;
            app.globalData.privacyResolve = null;
            resolve({ event: 'agree', buttonId: 'agree-btn' });
        }
    },

    onPrivacyDecline() {
        const that = this;
        haptics.light();
        wx.showModal({
            title: '需要你的同意',
            content: '不同意《隐私保护指引》将无法使用记录功能。确定退出吗？',
            confirmText: '退出',
            confirmColor: '#e24b4a',
            success: function (res) {
                if (res.confirm) {
                    const app = getApp();
                    if (app.globalData.privacyResolve) {
                        const resolve = app.globalData.privacyResolve;
                        app.globalData.privacyResolve = null;
                        resolve({ event: 'disagree' });
                    }
                    if (wx.exitMiniProgram) {
                        wx.exitMiniProgram({ fail: function () {} });
                    }
                } else {
                    that.setData({ showPrivacy: true });
                }
            },
        });
    },

    goPrivacyPage() {
        haptics.light();
        wx.navigateTo({ url: '/pages/privacy/privacy' });
    },

    /* ---- 其他 ---- */
    dismissChallenge() {
        haptics.light();
        this.setData({ challenge: null });
    },

    // 按下瞬间：唯一使用强触感的入口（设备最长时间震动）
    onFabTouchStart() {
        haptics.strong();
    },

    // 分享等次级主操作：与数据备份页一致的 standard 触感
    onShareTouch() {
        haptics.tap();
    },

    // 主按钮点击：抖动/涟漪动画后从底部拉起记录抽屉
    onFabTap() {
        if (this._fabLock) {
            return; // 防连点
        }
        if (this.data.sheetShow) {
            return;
        }
        this._fabLock = true;
        this.setData({ fabPressed: true });
        const that = this;
        this._fabTimer = setTimeout(function () {
            that._fabLock = false;
            that.setData({ fabPressed: false, sheetShow: true }, function () {
                that.openSheetForm();
            });
        }, 190);
    },

    // 抽屉里的表单可能晚一帧才渲染，取不到就再试一次
    openSheetForm() {
        const form = this.selectComponent('#recordForm');
        if (form) {
            form.open();
            return;
        }
        const that = this;
        setTimeout(function () {
            const retry = that.selectComponent('#recordForm');
            if (retry) {
                retry.open();
            }
        }, 80);
    },

    closeSheet() {
        this.setData({ sheetShow: false });
    },

    onSheetLeave() {
        // 下滑关闭 / 点遮罩关闭时同步状态并停止计时
        const form = this.selectComponent('#recordForm');
        if (form) {
            form.close();
        }
        if (this.data.sheetShow) {
            this.setData({ sheetShow: false });
        }
    },

    onSheetOverlay() {
        this.onSheetLeave();
    },

    onSheetSaved() {
        this.setData({ sheetShow: false });
        const that = this;
        setTimeout(function () {
            that.refresh();
            that.maybeCelebrate();
        }, 260);
    },

    onHide() {
        const form = this.selectComponent('#recordForm');
        if (form) {
            form.pause();
        }
        // 页面隐藏时清理动画状态与锁，避免返回后按钮卡住
        if (this._fabTimer) {
            clearTimeout(this._fabTimer);
            this._fabTimer = null;
        }
        this._fabLock = false;
        if (this.data.fabPressed) {
            this.setData({ fabPressed: false });
        }
    },

    goHistory() {
        haptics.light();
        const app = getApp();
        if (app && app.globalData) {
            app.globalData.historyTargetDay = '';
        }
        wx.switchTab({ url: '/pages/history/history' });
    },
});

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
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
