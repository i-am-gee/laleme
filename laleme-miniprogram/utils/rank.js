// 段位制度：只看连续记录天数，不看质量。
//
// 规则：
//   1. 连续天数到达某一档的门槛就晋级，只升不降；
//   2. 唯一会掉级的原因是「断签」：断签第 1 天掉 1 级，此后每再断 3 天再掉 1 级；
//   3. 掉级从「断签开始时的等级」往下算，同一天多次进入小程序不会重复扣；
//   4. 重新记录后从当前（已降低的）等级继续往上爬；爬回历史最高档时算「重回」，单开一场动画；
//   5. 每档配一个便便图标，越往后越"贵"，首页「记一次」按钮与段位刻度共用同一套。
//
// 注意：原型文案里「连续五天正常=荣耀黄金」比「七天=秩序白银」天数更短，直接照抄会出现
// 「连到第 6 天反而掉段」，所以黄金档取 10 天，让天数严格单调。要调档位只改 TIERS 一处。

const { dayStr, streakDays } = require('./constants.js');

const RANK_KEY = 'laleme_rank';

const TIERS = [
    { key: 'bronze', name: '倔强青铜大屎', short: '倔强青铜', brief: '青铜', days: 3, icon: '/assets/rank/bronze.png' },
    { key: 'silver', name: '秩序白银大屎', short: '秩序白银', brief: '白银', days: 7, icon: '/assets/rank/silver.png' },
    { key: 'gold', name: '荣耀黄金大屎', short: '荣耀黄金', brief: '黄金', days: 10, icon: '/assets/rank/gold.png' },
    { key: 'platinum', name: '尊贵铂金大屎', short: '尊贵铂金', brief: '铂金', days: 14, icon: '/assets/rank/platinum.png' },
    { key: 'diamond', name: '永恒钻石大屎', short: '永恒钻石', brief: '钻石', days: 21, icon: '/assets/rank/diamond.png' },
    { key: 'star', name: '至尊星耀大屎', short: '至尊星耀', brief: '星耀', days: 30, icon: '/assets/rank/star.png' },
    { key: 'king', name: '最强王者大屎', short: '最强王者', brief: '王者', days: 60, icon: '/assets/rank/king.png' },
];

const DECAY_EVERY = 3; // 断签后每再断 N 天多掉一级
const UNRANKED_ICON = '/assets/rank/none.png';

const UNRANKED = {
    key: 'none',
    name: '未定级',
    short: '未定级',
    brief: '未定级',
    days: 0,
    icon: UNRANKED_ICON,
};

/* ---------------- 日期工具：按本地自然日对齐，规避时区与夏令时 ---------------- */

function dayStart(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayDiff(fromMs, toMs) {
    return Math.round((dayStart(toMs) - dayStart(fromMs)) / 86400000);
}

function shiftDay(ms, delta) {
    const d = new Date(dayStart(ms));
    d.setDate(d.getDate() + delta);
    return d.getTime();
}

// 'YYYY-MM-DD' → 当天 0 点的时间戳（手动拆，避免 iOS 对日期字符串解析不一致）
function parseDayKey(key) {
    const parts = String(key).split('-');
    return new Date(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10)
    ).getTime();
}

/* ---------------- 状态存取 ---------------- */

function readState() {
    const raw = wx.getStorageSync(RANK_KEY);
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        level: typeof s.level === 'number' ? s.level : -1,
        peak: typeof s.peak === 'number' ? s.peak : -1,
        // 断签从哪一天开始（当天没记、且此前是连续的）
        brokenSince: typeof s.brokenSince === 'string' ? s.brokenSince : '',
        // 断签开始那一刻的等级，退级以它为基准，避免逐日重复扣
        levelAtBreak: typeof s.levelAtBreak === 'number' ? s.levelAtBreak : null,
        demoteAt: typeof s.demoteAt === 'number' ? s.demoteAt : 0,
        demoteTo: typeof s.demoteTo === 'string' ? s.demoteTo : '',
        demoteDays: typeof s.demoteDays === 'number' ? s.demoteDays : 0,
        noticeOff: s.noticeOff === 1 || s.noticeOff === true,
        // 待播的晋级动画：两个页面都会结算段位，谁先读完谁负责播，所以落在这里而不是页面里
        pendingUp: typeof s.pendingUp === 'number' ? s.pendingUp : 0,
        upName: typeof s.upName === 'string' ? s.upName : '',
        upIcon: typeof s.upIcon === 'string' ? s.upIcon : '',
        upDays: typeof s.upDays === 'number' ? s.upDays : 0,
        upRecovered: s.upRecovered === 1 || s.upRecovered === true,
        wasDemoted: s.wasDemoted === 1 || s.wasDemoted === true,
        // 上次结算时的记录条数：用来发现「记录被删过」，段位要跟着记录走
        count: typeof s.count === 'number' ? s.count : -1,
    };
}

function writeState(state) {
    wx.setStorageSync(RANK_KEY, state);
}

function tierAt(index) {
    return typeof index === 'number' && index >= 0 && index < TIERS.length ? TIERS[index] : UNRANKED;
}

/* ---------------- 结算 ---------------- */

// 只看连续天数：满足门槛的最高一档
function tierFor(streak) {
    let hit = -1;
    for (let i = 0; i < TIERS.length; i += 1) {
        if (streak < TIERS[i].days) {
            break;
        }
        hit = i;
    }
    return hit;
}

function evaluate(records) {
    const streak = streakDays(records || []);
    // 最后一次记录落在哪一天：断签退级要从这里起算
    let lastTs = 0;
    (records || []).forEach(function (r) {
        if (r.timestamp > lastTs) {
            lastTs = r.timestamp;
        }
    });
    return {
        streak: streak,
        today: Date.now(),
        lastDay: lastTs || Date.now(),
    };
}

// 段位视图：当前档、下一档、进度、提示语
function view(level, base) {
    const cur = tierAt(level);
    const next = level + 1 < TIERS.length ? TIERS[level + 1] : null;
    let pct = 0;
    let nextLine = '';
    let hint = '';

    if (!next) {
        pct = 100;
        nextLine = '已到最高段位，守住它';
        hint = '断一天就掉一级，别松手';
    } else {
        const needDays = Math.max(0, next.days - base.streak);
        pct = Math.min(100, Math.round(base.streak / next.days * 100));
        nextLine = needDays > 0
            ? '再连续 ' + needDays + ' 天解锁「' + next.name + '」（累计 ' + next.days + ' 天）'
            : '「' + next.name + '」的天数已到';
        hint = level >= 0
            ? '连续 ' + base.streak + ' 天 · 断一天掉一级'
            : '连续 ' + base.streak + ' 天 · 记满 ' + TIERS[0].days + ' 天就有段位';
    }
    return {
        name: cur.name,
        short: cur.short,
        icon: cur.icon,
        nextLine: nextLine,
        pct: pct,
        hint: hint,
    };
}

function finish(result, base, state) {
    const v = view(state.level, base);
    result.level = state.level;
    result.peak = state.peak;
    result.name = v.name;
    result.short = v.short;
    result.icon = v.icon;
    result.nextLine = v.nextLine;
    result.pct = v.pct;
    result.hint = v.hint;
    result.days = base.streak;
    result.peakName = tierAt(state.peak).name;
    result.peakIcon = tierAt(state.peak).icon;
    // 解锁刻度：只看连续天数，每档对应一个便便图标
    result.ticks = TIERS.map(function (t, i) {
        return {
            brief: t.brief,
            name: t.name,
            days: t.days,
            dayLabel: t.days + ' 天',
            icon: t.icon,
            on: base.streak >= t.days,
            cur: i === state.level,
        };
    });
    return result;
}

// 主入口：结算段位并落库，返回给页面渲染的结果
// records 需为 record-store.list() 的 data（按时间倒序的数组）
function sync(records) {
    const list = records || [];
    const base = evaluate(list);
    const state = readState();
    // 状态经常被多个页面重复结算，没变化就不写盘
    const snapshot = JSON.stringify(state);
    const commit = function () {
        if (JSON.stringify(state) !== snapshot) {
            writeState(state);
        }
    };
    const result = {
        level: state.level,
        peak: state.peak,
        days: base.streak,
        levelUp: false,
        recovered: false,
        demoted: false,
        brokenDays: 0,
    };

    // 全部清空：段位一起归零，别留下"幽灵称号"
    if (list.length === 0) {
        state.level = -1;
        state.peak = -1;
        state.brokenSince = '';
        state.levelAtBreak = null;
        state.demoteAt = 0;
        state.pendingUp = 0;
        state.wasDemoted = false;
        state.count = 0;
        commit();
        result.level = -1;
        result.peak = -1;
        return finish(result, base, state);
    }

    // 记录被删过：段位跟着记录走，不能留着删掉的天数换来的档位。
    // 正在受断签惩罚的用户例外——他们的 level 是惩罚后的值，本来就低于天数应得。
    const pruned = state.count >= 0 && list.length < state.count;
    if (pruned && !state.wasDemoted) {
        const recomputed = tierFor(base.streak);
        if (recomputed < state.level) {
            state.level = recomputed;
            // 最高档也一起回落：那段历史已经不在了
            state.peak = recomputed;
            state.brokenSince = '';
            state.levelAtBreak = null;
            state.demoteAt = 0;
            state.demoteDays = 0;
            // 删记录不是断签，不弹掉级横幅
            state.noticeOff = true;
        }
    }
    state.count = list.length;

    if (base.streak > 0) {
        // 还在连续：只升不降
        state.brokenSince = '';
        state.levelAtBreak = null;
        const earned = tierFor(base.streak);
        if (earned > state.level) {
            // 掉过级又爬回原来的最高档，算「重回」，文案不一样
            const recovered = !!(state.wasDemoted && earned >= state.peak && state.demoteAt);
            state.level = earned;
            state.peak = Math.max(state.peak, earned);
            state.wasDemoted = recovered ? false : state.wasDemoted;
            if (recovered) {
                // 已经爬回来了，掉级横幅没必要再挂在那儿
                state.noticeOff = true;
            }
            result.levelUp = true;
            result.recovered = recovered;
            // 晋级动画记在存储里：首页与统计页都会结算，谁先看到谁负责播
            state.pendingUp = Date.now();
            state.upName = tierAt(earned).name;
            state.upIcon = tierAt(earned).icon;
            state.upDays = base.streak;
            state.upRecovered = recovered;
        }
    } else {
        // 断签：断签首日始终由「最后一次记录」推导，不缓存日期，
        // 否则隔几天再进来还会按第一次的断签天数算，也永远停在同一级
        state.brokenSince = dayStr(shiftDay(base.lastDay, 1));
        if (state.levelAtBreak === null) {
            state.levelAtBreak = state.level;
        }
        const brokenDays = Math.max(0, dayDiff(parseDayKey(state.brokenSince), base.today)) + 1;
        result.brokenDays = brokenDays;
        const penalty = 1 + Math.floor(Math.max(0, brokenDays - 1) / DECAY_EVERY);
        const nextLevel = Math.max(-1, state.levelAtBreak - penalty);
        if (nextLevel < state.level) {
            result.demoted = true;
            state.level = nextLevel;
            state.demoteAt = base.today;
            state.demoteTo = tierAt(nextLevel).name;
            state.demoteDays = brokenDays;
            state.noticeOff = false;
            // 标记"掉过级"，之后重新爬回最高档要播「重回」动画
            state.wasDemoted = true;
        } else if (state.demoteAt) {
            // 已经掉到地板，继续断签也要把天数刷新，横幅上的数字才跟得上
            state.demoteDays = brokenDays;
        }
    }

    commit();
    return finish(result, base, state);
}

// 取走待播的晋级动画；超过 2 小时的旧记录直接丢弃，避免隔天突然放一场
function takePendingUp() {
    const state = readState();
    if (!state.pendingUp) {
        return null;
    }
    const fresh = Date.now() - state.pendingUp < 2 * 3600 * 1000;
    const out = {
        name: state.upName,
        icon: state.upIcon,
        days: state.upDays,
        recovered: !!state.upRecovered,
    };
    state.pendingUp = 0;
    state.upName = '';
    state.upIcon = '';
    state.upDays = 0;
    state.upRecovered = false;
    writeState(state);
    return fresh ? out : null;
}

// 断签横幅：只在掉级后 3 天内出现，用户点掉后不再打扰
// 文案从存档读，不依赖本次 sync 的即时结果——否则切一次页面横幅就没了
function notice() {
    const state = readState();
    if (!state.demoteAt || state.noticeOff) {
        return '';
    }
    if (Date.now() - state.demoteAt > 3 * 86400000) {
        return '';
    }
    const to = state.demoteTo || '';
    const days = state.demoteDays > 0 ? state.demoteDays : 1;
    const head = to && to !== UNRANKED.name ? '段位掉到「' + to + '」' : '段位清零了';
    return head + '。断了 ' + days + ' 天，今天记一次就能止住';
}

function dismissNotice() {
    const state = readState();
    state.noticeOff = 1;
    writeState(state);
}

function clear() {
    wx.removeStorageSync(RANK_KEY);
}

module.exports = {
    RANK_KEY: RANK_KEY,
    TIERS: TIERS,
    UNRANKED_ICON: UNRANKED_ICON,
    evaluate: evaluate,
    sync: sync,
    takePendingUp: takePendingUp,
    notice: notice,
    dismissNotice: dismissNotice,
    clear: clear,
};
