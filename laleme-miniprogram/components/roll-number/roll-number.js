/**
 * 拉霸滚动数字
 * 原理：每一位数字是一列，列内竖排 REPEAT 轮 0-9；
 * 用 transform: translateY(百分比) 滚到目标位（百分比相对数字条自身高度，天然适配 rpx）。
 * 逐列递增时长，形成从左到右依次落定的老虎机手感。
 */
const REPEAT = 3;              // 每列滚动轮数
const TOTAL = REPEAT * 10;     // 列内格数
const BASE_DUR = 880;          // 首位滚动时长 ms
const STAGGER = 140;           // 每列递增时长 ms

function digitsOf(value) {
    const s = String(value == null ? '' : value);
    const out = [];
    for (let i = 0; i < s.length; i += 1) {
        const c = s.charAt(i);
        if (c >= '0' && c <= '9') {
            out.push(Number(c));
        }
    }
    return out;
}

function buildColumns(value) {
    const digits = digitsOf(value);
    return digits.map(function (d, i) {
        const cells = [];
        for (let k = 0; k < TOTAL; k += 1) {
            cells.push({ k: k, v: k % 10 });
        }
        return {
            key: 'c' + i,
            cells: cells,
            offset: 0,
            // 落点：最后一轮的第 d 格
            target: -((REPEAT - 1) * 10 + d) * 100 / TOTAL,
            dur: BASE_DUR + i * STAGGER,
        };
    });
}

Component({
    properties: {
        // 纯数字字符串，如 '18'；空则用 text 兜底
        value: { type: null, value: '' },
        // 静态文案（无数据时显示），给了就不滚
        text: { type: String, value: '' },
        // 单位，如 '天' / '次' / '分'
        suffix: { type: String, value: '' },
        // 数字字号 rpx
        size: { type: String, value: '44' },
        // 单位字号 rpx
        suffixSize: { type: String, value: '24' },
    },

    data: {
        cols: [],
        instant: true,
        fontSize: '44rpx',
        cellH: '54rpx',
        suffixFont: '24rpx',
    },

    lifetimes: {
        attached() {
            this.applyLayout();
            this.play();
        },
        detached() {
            clearTimeout(this._t1);
            clearTimeout(this._t2);
        },
    },

    observers: {
        value() {
            this.play();
        },
        text() {
            this.play();
        },
        size() {
            this.applyLayout();
        },
        suffixSize() {
            this.applyLayout();
        },
    },

    methods: {
        applyLayout() {
            const n = Number(this.data.size) || 44;
            const sn = Number(this.data.suffixSize) || 24;
            const h = Math.round(n * 1.2 / 2) * 2; // 取偶数，避免 30 格累计误差
            this.setData({
                fontSize: n + 'rpx',
                cellH: h + 'rpx',
                suffixFont: sn + 'rpx',
            });
        },

        play() {
            if (this.data.text) {
                return; // 静态文案不动画
            }
            const cols = buildColumns(this.data.value);
            if (!cols.length) {
                this.setData({ cols: [] });
                return;
            }
            const that = this;
            clearTimeout(this._t1);
            clearTimeout(this._t2);
            // 三段式：先无过渡归零 → 开过渡 → 再设目标位，保证每次都能重播
            const zeroed = cols.map(function (c) {
                return Object.assign({}, c, { offset: 0 });
            });
            this.setData({ cols: zeroed, instant: true }, function () {
                that._t1 = setTimeout(function () {
                    that.setData({ instant: false }, function () {
                        that._t2 = setTimeout(function () {
                            that.setData({
                                cols: cols.map(function (c) {
                                    return Object.assign({}, c, { offset: c.target });
                                }),
                            });
                        }, 32);
                    });
                }, 32);
            });
        },
    },
});
