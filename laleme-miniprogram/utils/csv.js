// CSV 导出/导入：备份恢复页与「我的」页共用
const { MOOD_TEXT, bristolLabel } = require('./constants.js');

const HEADER = ['时间', '时长(分钟)', '布里斯托类型', '感觉'];

// 与文本对应的满意度 key（导入用）
const MOOD_KEYS = {};
Object.keys(MOOD_TEXT).forEach(function (k) {
    MOOD_KEYS[MOOD_TEXT[k]] = k;
});

// 组装 CSV 文本
function buildCsv(records) {
    const rows = [HEADER];
    (records || []).forEach(function (r) {
        rows.push([
            new Date(r.timestamp).toISOString(),
            String(r.durationMin),
            bristolLabel(r.bristol),
            r.mood ? MOOD_TEXT[r.mood] : '未记',
        ]);
    });
    return rows.map(function (row) {
        return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
}

// CSV 解析：支持引号转义、BOM、无引号、常见日期格式
function parseCsv(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const lines = clean.split(/\r?\n/);
    const out = [];
    lines.forEach(function (line) {
        if (!line.trim()) {
            return;
        }
        const cells = splitLine(line);
        if (String(cells[0] || '').replace(/\uFEFF/g, '').indexOf('时间') !== -1) {
            return; // 表头
        }
        const ts = parseDateCell(cells[0]);
        const dur = parseInt(cells[1], 10);
        if (!Number.isFinite(ts) || !Number.isFinite(dur) || dur <= 0) {
            return;
        }
        let bristol = null;
        const m = String(cells[2] || '').match(/^([1-7])/);
        if (m) {
            bristol = parseInt(m[1], 10);
        }
        let mood = null;
        const moodText = String(cells[3] || '').trim();
        if (moodText && MOOD_KEYS[moodText]) {
            mood = MOOD_KEYS[moodText];
        }
        out.push({
            timestamp: ts,
            durationMin: Math.min(dur, 720),
            bristol: bristol,
            mood: mood,
        });
    });
    return out;
}

// 日期解析：ISO 8601 / 2026-11-13 20:00 / 2026/11/13 20:00:00
function parseDateCell(raw) {
    const s = String(raw || '').trim().replace(/^"|"$/g, '');
    if (!s) {
        return NaN;
    }
    const iso = Date.parse(s);
    if (Number.isFinite(iso)) {
        return iso;
    }
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
        return new Date(
            parseInt(m[1], 10),
            parseInt(m[2], 10) - 1,
            parseInt(m[3], 10),
            parseInt(m[4] || '0', 10),
            parseInt(m[5] || '0', 10),
            parseInt(m[6] || '0', 10)
        ).getTime();
    }
    return NaN;
}

function splitLine(line) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            cells.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    cells.push(cur);
    return cells;
}

module.exports = {
    buildCsv: buildCsv,
    parseCsv: parseCsv,
};
