// 统计口径：连续天数、段位、近七天活跃天数、平均时长。
// 全部按东八区自然日计算——服务端时区可能是 UTC，不能直接用本地时间。

const TIERS = [
  { days: 3, name: '倔强青铜' },
  { days: 7, name: '秩序白银' },
  { days: 10, name: '荣耀黄金' },
  { days: 14, name: '尊贵铂金' },
  { days: 21, name: '永恒钻石' },
  { days: 30, name: '至尊星耀' },
  { days: 60, name: '最强王者' },
];

const TZ_OFFSET = 8 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

// 东八区的「日序号」：同一自然日返回同一个整数
export function dayIndex(ts) {
  return Math.floor((ts + TZ_OFFSET) / DAY);
}

export function dayKey(ts) {
  const d = new Date(ts + TZ_OFFSET);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function todayKey() {
  return dayKey(Date.now());
}

// 今天 0 点（东八区）的时间戳，用于"当天有没有记录"的判断
export function startOfToday(now = Date.now()) {
  return dayIndex(now) * DAY - TZ_OFFSET;
}

export function tierOf(streak) {
  let idx = -1;
  for (let i = 0; i < TIERS.length; i += 1) {
    if (streak >= TIERS[i].days) {
      idx = i;
    }
  }
  return idx < 0
    ? { level: -1, name: '未定级', days: 0, next: TIERS[0].days }
    : {
        level: idx,
        name: TIERS[idx].name,
        days: TIERS[idx].days,
        next: idx + 1 < TIERS.length ? TIERS[idx + 1].days : null,
      };
}

// rows: [{ ts, duration_min }]，按 ts 降序
export function summarize(rows, now = Date.now()) {
  const days = new Set();
  rows.forEach((r) => days.add(dayIndex(Number(r.ts))));

  const today = dayIndex(now);
  const todayDone = days.has(today);

  // 连续天数：今天有就从今天起算，今天没有就从昨天起算（给用户一整天机会补）
  let cursor = todayDone ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }

  // 近七天活跃天数（去重按自然日，避免一天多次刷分）
  const weekFrom = today - 6;
  let weekDays = 0;
  days.forEach((d) => {
    if (d >= weekFrom) {
      weekDays += 1;
    }
  });

  const withDur = rows.filter((r) => Number(r.duration_min) > 0);
  const avgMin = withDur.length
    ? Math.round(withDur.reduce((s, r) => s + Number(r.duration_min), 0) / withDur.length)
    : 0;

  return { todayDone, streak, tier: tierOf(streak), weekDays, avgMin, total: rows.length };
}

// 时长得分：以 5.5 分钟为峰的倒 U，久蹲不加分
export function durationScore(avgMin) {
  if (!avgMin) {
    return 0;
  }
  const x = Math.log(avgMin / 5.5);
  return Math.round(100 * Math.exp(-(x * x) / 2));
}

// 排名：活跃天数 > 连续天数 > 时长得分，同分并列
export function rankList(list) {
  const sorted = list
    .map((u) => ({ ...u, score: durationScore(u.avgMin) }))
    .sort((a, b) => {
      if (b.weekDays !== a.weekDays) return b.weekDays - a.weekDays;
      if (b.streak !== a.streak) return b.streak - a.streak;
      return b.score - a.score;
    });

  let lastRank = 0;
  let lastKey = null;
  return sorted.map((u, i) => {
    const key = `${u.weekDays}|${u.streak}|${u.score}`;
    if (key !== lastKey) {
      lastRank = i + 1;
      lastKey = key;
    }
    return { ...u, rank: lastRank };
  });
}
