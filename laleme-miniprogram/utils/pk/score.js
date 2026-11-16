/**
 * PK 评分规则
 *
 * 两条设计前提：
 * 1. 时长不是越久越好。久蹲不代表健康，线性「越久越高」会直接制造刷分行为，
 *    所以用倒 U 曲线，峰值落在 5.5 分钟。
 * 2. 质量看布里斯托分型，感受只做小幅修正（±5 上下），不喧宾夺主。
 *
 * 服务端上线后，这份常量与公式要复制到云函数里作为唯一权威；
 * 客户端只用于展示与本地模拟，不得以此作为榜单依据。
 */

const IDEAL_MIN = 5.5;

// 布里斯托 1-7 型的基础分，4 型（理想）满分
const BRISTOL_BASE = { 1: 45, 2: 62, 3: 85, 4: 100, 5: 85, 6: 58, 7: 35 };

// 感受修正：通畅加分，费劲扣分
const MOOD_ADJUST = { good: 5, normal: 0, hard: -7 };

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function pad2(n) {
    return n < 10 ? '0' + n : String(n);
}

// 时长分：5.5 分钟满分，两端按对数距离衰减；不足半分钟视为无效
function durationScore(min) {
    const t = Number(min);
    if (!Number.isFinite(t) || t < 0.5) {
        return 0;
    }
    const x = Math.log(t / IDEAL_MIN);
    return clamp(100 * Math.exp(-(x * x) / 2), 0, 100);
}

// 质量分：没填性状返回 null，不参与均值（避免用 0 分拉低整体）
function qualityScore(bristol, mood) {
    const base = BRISTOL_BASE[bristol];
    if (base === undefined) {
        return null;
    }
    return clamp(base + (MOOD_ADJUST[mood] || 0), 0, 100);
}

/**
 * 把一段时间内的记录折成 PK 用的三个指标
 * 次数按全部记录计；平均时长只算有时长的；质量只算填了性状的
 */
function aggregate(records, sinceTs) {
    const list = (records || []).filter(function (r) {
        return r && Number(r.timestamp) >= sinceTs;
    });
    let minSum = 0;
    let minN = 0;
    let qSum = 0;
    let qN = 0;
    list.forEach(function (r) {
        const d = Number(r.durationMin);
        if (d > 0) {
            minSum += d;
            minN += 1;
        }
        const q = qualityScore(r.bristol, r.mood);
        if (q !== null) {
            qSum += q;
            qN += 1;
        }
    });
    return {
        count: list.length,
        avgMin: minN ? minSum / minN : null,
        avgQuality: qN ? Math.round(qSum / qN) : null,
        durationSamples: minN,
        qualitySamples: qN,
    };
}

// 分钟数转 分:秒，用于展示
function formatDuration(min) {
    if (min === null || min === undefined || !Number.isFinite(Number(min))) {
        return '—';
    }
    const total = Math.round(Number(min) * 60);
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
}

module.exports = {
    IDEAL_MIN: IDEAL_MIN,
    durationScore: durationScore,
    qualityScore: qualityScore,
    aggregate: aggregate,
    formatDuration: formatDuration,
};
