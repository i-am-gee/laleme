const { fmtDT, fmtDur, bristolLabel, streakDays, dayStr, todayStr, CHEERS, REMINDER_TIME_KEY, REMINDER_ON_KEY, pad2 } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const share = require('../../utils/share.js');

const store = createRecordStore();

const CONFETTI_COLORS = ['#f0997b', '#97c459', '#85b7eb', '#ed93b1', '#fac775', '#5dcaa5'];

const PRIVACY_SUMMARY = [
    '1. 你的打卡记录仅保存在本机（本地存储），不上传、不收集任何个人信息。',
    '2. 仅在你主动点击分享时，微信向你选择的好友发送打卡统计卡片。',
    '3. 全文见「用户隐私保护指引」，同意后即可使用。',
].join('\n');

function buildConfetti() {
    const pieces = [];
    for (let i = 0; i < 14; i += 1) {
        pieces.push({
            left: Math.round(4 + Math.random() * 92),
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            delay: (Math.random() * 0.8).toFixed(2),
            duration: (1.4 + Math.random() * 1.2).toFixed(2),
            size: 10 + Math.round(Math.random() * 8),
            round: i % 3 === 0,
        });
    }
    return pieces;
}

function buildCalendar(records) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const pooped = {};
    records.forEach(function (r) {
        const d = new Date(r.timestamp);
        if (d.getFullYear() === year && d.getMonth() === month) {
            pooped[d.getDate()] = true;
        }
    });
    const offset = (new Date(year, month, 1).getDay() + 6) % 7; // 周一开头
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = now.getDate();
    const cells = [];
    for (let i = 0; i < offset; i += 1) {
        cells.push({ blank: true });
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
        cells.push({
            blank: false,
            day: d,
            pooped: !!pooped[d],
            today: d === today,
            future: d > today,
        });
    }
    return {
        cells: cells,
        monthLabel: (month + 1) + ' 月',
        poopedCount: Object.keys(pooped).length,
    };
}

// 今日提醒：开关开启、当前时间已过设定时间、今天尚未打卡
function shouldShowReminder(todayCount) {
    if (!wx.getStorageSync(REMINDER_ON_KEY) || todayCount > 0) {
        return false;
    }
    const t = String(wx.getStorageSync(REMINDER_TIME_KEY) || '08:00');
    const parts = t.split(':');
    const target = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    return cur >= target;
}

Page({
    data: {
        statusClass: 'notyet',
        statusTitle: '拉了么？',
        statusSub: '今天还没拉',
        lastText: '还没有记录',
        streakText: '未开始',
        monthCountText: '0 次',
        challenge: null,
        calendar: null,
        reminderShow: false,
        showCelebrate: false,
        celebrateText: '',
        confetti: [],
        showPrivacy: false,
        privacySummary: PRIVACY_SUMMARY,
        privacyContractName: '《小程序隐私保护指引》',
    },

    onLoad(options) {
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
        this.refresh();
        this.maybeCelebrate();
        this.checkPrivacy();
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
                    statusSub: '今天已拉 ' + today.length + ' 次，继续保持',
                });
            } else {
                that.setData({
                    statusClass: 'notyet',
                    statusTitle: '拉了么？',
                    statusSub: '今天还没拉',
                });
            }
            let lastText = '还没有记录';
            if (records.length > 0) {
                let latest = records[0];
                for (let i = 1; i < records.length; i += 1) {
                    if (records[i].timestamp > latest.timestamp) {
                        latest = records[i];
                    }
                }
                lastText = fmtDT(latest.timestamp) + ' · ' + fmtDur(latest.durationMin) + ' · ' + bristolLabel(latest.bristol);
            }
            const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
            const monthCount = records.filter(function (r) { return r.timestamp >= monthAgo; }).length;
            const streak = streakDays(records);
            const calendar = buildCalendar(records);
            that._stats = { streak: streak, monthDays: calendar.poopedCount };
            that.setData({
                lastText: lastText,
                streakText: streak > 0 ? streak + ' 天' : '未开始',
                monthCountText: monthCount + ' 次',
                calendar: calendar,
                reminderShow: shouldShowReminder(today.length),
            }, function () {
                share.ensurePoster(that, that._stats);
            });
        });
    },

    onShareAppMessage() {
        return share.makeShareInfo(this._stats);
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

    /* ---- 庆祝动画 ---- */
    maybeCelebrate() {
        const flag = wx.getStorageSync('laleme_celebrate_flag');
        if (flag && Date.now() - Number(flag) < 10000) {
            wx.removeStorageSync('laleme_celebrate_flag');
            const that = this;
            this.setData({
                showCelebrate: true,
                celebrateText: CHEERS[Math.floor(Math.random() * CHEERS.length)],
                confetti: buildConfetti(),
            });
            this._celebrateTimer = setTimeout(function () {
                that.setData({ showCelebrate: false });
            }, 3200);
        }
    },

    hideCelebrate() {
        if (this._celebrateTimer) {
            clearTimeout(this._celebrateTimer);
            this._celebrateTimer = null;
        }
        this.setData({ showCelebrate: false });
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
        wx.navigateTo({ url: '/pages/privacy/privacy' });
    },

    /* ---- 其他 ---- */
    dismissChallenge() {
        this.setData({ challenge: null });
    },

    goRecord() {
        wx.navigateTo({ url: '/pages/record/record' });
    },

    goHistory() {
        wx.switchTab({ url: '/pages/history/history' });
    },
});
