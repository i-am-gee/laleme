// 布里斯托分类与共享常量、展示辅助
const BRISTOL = [
    { t: 1, name: '硬球', desc: '一颗颗硬球', hint: '严重便秘，多喝水、多补膳食纤维', level: 'bad' },
    { t: 2, name: '结块', desc: '腊肠状结块', hint: '轻度便秘，多吃蔬果粗粮', level: 'warn' },
    { t: 3, name: '干裂', desc: '干裂腊肠', hint: '正常偏干，注意补水', level: 'ok' },
    { t: 4, name: '理想', desc: '光滑软条', hint: '理想状态，继续保持！', level: 'ok' },
    { t: 5, name: '软块', desc: '软块边缘清晰', hint: '偏软，建议补充膳食纤维', level: 'ok' },
    { t: 6, name: '糊状', desc: '糊状蓬松', hint: '轻度腹泻，注意饮食清淡', level: 'warn' },
    { t: 7, name: '水状', desc: '完全水状', hint: '腹泻，注意补水休息，持续请就医', level: 'bad' },
];

const MOOD_TEXT = { good: '通畅', normal: '一般', hard: '费劲' };

const CHEERS = ['顺风顺水！', '今天也畅通了！', '一身轻松！', '完美完成任务！', '肠道谢谢你！', '纪录 +1，继续加油！'];

const STORAGE_KEY = 'laleme_records';

// 成就徽章定义：同色系棕色图标，点亮/未点亮两套（与分享海报共用）
const BADGES = [
    { id: 'week', name: '七日全勤', desc: '连续记录 7 天', iconOn: '/assets/badges/week-on.png', iconOff: '/assets/badges/week-off.png' },
    { id: 'flash', name: '闪电侠', desc: '单次用时 ≤ 3 分钟', iconOn: '/assets/badges/flash-on.png', iconOff: '/assets/badges/flash-off.png' },
    { id: 'marathon', name: '马拉松选手', desc: '单次用时 ≥ 20 分钟', iconOn: '/assets/badges/marathon-on.png', iconOff: '/assets/badges/marathon-off.png' },
    { id: 'collector', name: '收藏家', desc: '集齐布里斯托 1-7 型', iconOn: '/assets/badges/collector-on.png', iconOff: '/assets/badges/collector-off.png' },
];

const PRIVACY_TEXT = [
    '更新日期：2026-11-11　生效日期：2026-11-11',
    '「拉了么」（下称"本应用"）非常重视你的个人信息与隐私保护。请在使用前仔细阅读本指引，你点击"同意并继续"即表示已阅读并同意本指引全部内容。',
    '一、我们收集的信息',
    '1. 打卡记录：你主动记录的如厕时间、时长、布里斯托性状、满意度，仅存储在你本机的小程序本地存储中。',
    '2. 本应用不收集你的微信昵称、头像、手机号、位置、通讯录等任何个人信息。',
    '3. 本应用不接入任何第三方统计、广告或追踪 SDK。',
    '二、信息的使用与存储',
    '1. 全部数据仅保存在你的设备本地，不上传服务器、不做云端同步。',
    '2. 你可随时在"我的"页清空全部数据，或通过删除小程序清除本地记录。',
    '三、分享功能',
    '1. 仅当你主动点击"挑战好友"等分享按钮时，微信将向你选择的好友或朋友圈发送一条分享卡片，内容仅包含打卡统计（连续天数、本月次数、本月打卡日历图形、已点亮的成就徽章）。',
    '2. 本应用不会自动分享或外发任何信息。',
    '四、你的权利',
    '1. 你可在"我的 - 数据备份与恢复"页随时导出（文件或剪贴板）、导入或清空全部数据，导入导出均只在本机完成。',
    '2. 你撤回同意后，本应用将无法继续提供记录功能。',
    '五、未成年人保护',
    '本应用面向成年人，不面向未成年人提供服务。',
    '六、联系我们',
    '如对本指引有任何疑问，可通过小程序帐号主体在微信公众平台的对外联系方式反馈。',
].join('\n');

// 分享标题模板，{s} 连续天数、{m} 本月天数
// 分享文案：走「关心」而不是「比拼」的路子，像顺手问候一句
const SHARE_TITLES = [
    '今天拉了么？我已经连续 {s} 天了，你也多留意身体',
    '今天拉了么？我连着记了 {s} 天，也想听听你的',
    '我们一起开始「拉」吧，从今天这一次开始',
    '今天拉了么？我这个月记了 {m} 次，别硬撑',
    '连着 {s} 天，我把这件小事记下来了，你呢',
];

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

function dayStr(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function todayStr() {
    return dayStr(Date.now());
}

function fmtTime(ms) {
    const d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function fmtDT(ms) {
    const d = new Date(ms);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + fmtTime(ms);
}

function fmtDur(min) {
    if (min >= 60) {
        return Math.floor(min / 60) + ' 小时 ' + (min % 60) + ' 分';
    }
    return min + ' 分钟';
}

function bristolLabel(t) {
    if (!t) {
        return '未记性状';
    }
    const b = BRISTOL[t - 1];
    return b ? b.t + ' 型 ' + b.name : '未记性状';
}

// 连续记录天数：从今天（今天没拉则从昨天）往前数有记录的天数
function streakDays(records) {
    const days = {};
    records.forEach(function (r) { days[dayStr(r.timestamp)] = true; });
    let n = 0;
    const d = new Date();
    if (!days[dayStr(d.getTime())]) {
        d.setDate(d.getDate() - 1);
    }
    while (days[dayStr(d.getTime())]) {
        n += 1;
        d.setDate(d.getDate() - 1);
    }
    return n;
}

// 成就判定，返回 { week, flash, marathon, collector }
function achievements(records) {
    const flash = records.some(function (r) { return r.durationMin <= 3; });
    const marathon = records.some(function (r) { return r.durationMin >= 20; });
    const types = {};
    records.forEach(function (r) { if (r.bristol) { types[r.bristol] = true; } });
    return {
        week: streakDays(records) >= 7,
        flash: flash,
        marathon: marathon,
        collector: Object.keys(types).length >= 7,
    };
}

function pickRecord(id, records) {
    for (let i = 0; i < records.length; i += 1) {
        if (records[i].id === id) {
            return records[i];
        }
    }
    return null;
}

// 本月日历（首页与分享海报共用同一口径）
// 返回 cells（含 blank/day/count/today/future）、countMap、activeDays 等
function monthCalendar(records, baseMs) {
    const real = new Date();
    const now = baseMs ? new Date(baseMs) : real;
    const year = now.getFullYear();
    const month = now.getMonth();
    // 只有渲染的确实是「当前月」时，才标记今天与未来日期
    const isCurrent = year === real.getFullYear() && month === real.getMonth();
    const countMap = {};
    (records || []).forEach(function (r) {
        const d = new Date(r.timestamp);
        if (d.getFullYear() === year && d.getMonth() === month) {
            countMap[d.getDate()] = (countMap[d.getDate()] || 0) + 1;
        }
    });
    const offset = (new Date(year, month, 1).getDay() + 6) % 7; // 周一开头
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = isCurrent ? real.getDate() : -1;
    const cells = [];
    for (let i = 0; i < offset; i += 1) {
        cells.push({ blank: true, day: 0, count: 0, today: false, future: false });
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
        const count = countMap[d] || 0;
        cells.push({
            blank: false,
            day: d,
            count: count,
            pooped: count > 0,
            today: d === today,
            future: isCurrent && d > today,
        });
    }
    // 固定 6 行（42 格）：行数不足时补齐空白，保证切月时日历高度与行距完全一致
    const CELL_TOTAL = 42;
    while (cells.length < CELL_TOTAL) {
        cells.push({ blank: true, day: 0, count: 0, today: false, future: false });
    }
    return {
        cells: cells,
        countMap: countMap,
        activeDays: Object.keys(countMap).length,
        offset: offset,
        daysInMonth: daysInMonth,
        today: today,
        isCurrent: isCurrent,
        monthLabel: (month + 1) + ' 月',
        year: year,
        monthIndex: month,
    };
}

module.exports = {
    BRISTOL: BRISTOL,
    MOOD_TEXT: MOOD_TEXT,
    CHEERS: CHEERS,
    STORAGE_KEY: STORAGE_KEY,
    BADGES: BADGES,
    PRIVACY_TEXT: PRIVACY_TEXT,
    SHARE_TITLES: SHARE_TITLES,
    dayStr: dayStr,
    todayStr: todayStr,
    fmtTime: fmtTime,
    fmtDT: fmtDT,
    fmtDur: fmtDur,
    bristolLabel: bristolLabel,
    streakDays: streakDays,
    achievements: achievements,
    monthCalendar: monthCalendar,
    pickRecord: pickRecord,
    pad2: pad2,
};
