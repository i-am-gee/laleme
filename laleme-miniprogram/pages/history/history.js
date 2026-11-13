const { dayStr, todayStr, fmtTime, fmtDur, bristolLabel, MOOD_TEXT } = require('../../utils/constants.js');
const { createRecordStore } = require('../../utils/record-store.js');
const haptics = require('../../utils/haptics.js');

const store = createRecordStore();

const ACTION_W = 68; // 单个操作按钮宽度（px），与 wxss 保持一致
const OPEN_X = -ACTION_W * 2;

Page({
    data: {
        groups: [],
        empty: false,
        hintDim: false,
        highlightKey: '',
    },

    onShow() {
        syncTabBar(this, 1);
        const app = getApp();
        const target = app && app.globalData ? app.globalData.historyTargetDay : '';
        if (app && app.globalData) {
            app.globalData.historyTargetDay = '';
        }
        this._targetDay = target || '';
        this.refresh();
    },

    onHide() {
        this._targetDay = '';
    },

    refresh() {
        const that = this;
        store.list().then(function (res) {
            if (res.error) {
                wx.showToast({ title: '读取失败，请重试', icon: 'none' });
                return;
            }
            const records = res.data;
            const groups = [];
            let lastDay = '';
            records.forEach(function (r) {
                const day = dayStr(r.timestamp);
                if (day !== lastDay) {
                    lastDay = day;
                    groups.push({
                        key: day,
                        day: day === todayStr() ? '今天' : day,
                        count: 0,
                        items: [],
                    });
                }
                const g = groups[groups.length - 1];
                g.count += 1;
                g.items.push({
                    id: r.id,
                    time: fmtTime(r.timestamp),
                    detail: fmtDur(r.durationMin) + ' · ' + bristolLabel(r.bristol) + (r.mood ? ' · ' + MOOD_TEXT[r.mood] : ''),
                    x: 0,
                });
            });
            that.setData({ groups: groups, empty: records.length === 0 }, function () {
                that.anchorToTarget();
            });
        });
    },

    // 从首页日历跳过来时，锚定并高亮当天
    anchorToTarget() {
        const target = this._targetDay;
        if (!target) {
            return;
        }
        this._targetDay = '';
        const that = this;
        const exists = this.data.groups.some(function (g) { return g.key === target; });
        if (!exists) {
            wx.showToast({ title: '这天没有记录', icon: 'none' });
            return;
        }
        this.setData({ highlightKey: target });
        setTimeout(function () {
            wx.pageScrollTo({
                selector: '#d-' + target,
                offsetTop: -54,
                duration: 260,
                fail: function () {
                    // 锚点定位失败时不影响页面可用性
                },
            });
            haptics.light();
        }, 80);
        this._hlTimer = setTimeout(function () {
            that.setData({ highlightKey: '' });
        }, 2600);
    },

    /* ---- 左滑菜单 ---- */
    onTouchStart(event) {
        const ds = event.currentTarget.dataset;
        const touch = event.touches[0];
        const item = this.data.groups[ds.g].items[ds.i];
        this._g = Number(ds.g);
        this._i = Number(ds.i);
        this._sx = touch.clientX;
        this._sy = touch.clientY;
        this._base = item.x || 0;
        this._axis = '';
        this._moved = false;
        this.closeOthers(this._g, this._i);
    },

    onTouchMove(event) {
        if (this._g === undefined) {
            return;
        }
        const touch = event.touches[0];
        const dx = touch.clientX - this._sx;
        const dy = touch.clientY - this._sy;
        if (!this._axis) {
            if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
                return;
            }
            this._axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        }
        if (this._axis !== 'h') {
            return;
        }
        this._moved = true;
        let next = this._base + dx;
        if (next > 0) {
            next = 0;
        }
        if (next < OPEN_X) {
            // 越界阻尼
            next = OPEN_X + (next - OPEN_X) * 0.25;
        }
        this.setItemX(this._g, this._i, next);
    },

    onTouchEnd() {
        if (this._g === undefined) {
            return;
        }
        if (this._axis === 'h') {
            const item = this.data.groups[this._g].items[this._i];
            const open = item.x < OPEN_X / 2;
            this.setItemX(this._g, this._i, open ? OPEN_X : 0);
            if (open) {
                haptics.light();
                this.setData({ hintDim: true });
            }
        }
        this._axis = '';
        this._g = undefined;
    },

    setItemX(g, i, x) {
        const patch = {};
        patch['groups[' + g + '].items[' + i + '].x'] = Math.round(x);
        this.setData(patch);
    },

    closeOthers(g, i) {
        const patch = {};
        let dirty = false;
        this.data.groups.forEach(function (group, gi) {
            group.items.forEach(function (item, ii) {
                if ((gi !== g || ii !== i) && item.x !== 0) {
                    item.x = 0;
                    patch['groups[' + gi + '].items[' + ii + '].x'] = 0;
                    dirty = true;
                }
            });
        });
        if (dirty) {
            this.setData(patch);
        }
    },

    // 点击行本身：有展开的菜单先收起，否则进入编辑
    onItemTap(event) {
        if (this._moved) {
            this._moved = false;
            return;
        }
        const ds = event.currentTarget.dataset;
        const item = this.data.groups[ds.g].items[ds.i];
        if (item.x !== 0) {
            this.setItemX(ds.g, ds.i, 0);
            return;
        }
        haptics.tap();
        wx.navigateTo({ url: '/pages/record/record?id=' + item.id });
    },

    onEdit(event) {
        const ds = event.currentTarget.dataset;
        const item = this.data.groups[ds.g].items[ds.i];
        haptics.tap();
        this.setItemX(ds.g, ds.i, 0);
        wx.navigateTo({ url: '/pages/record/record?id=' + item.id });
    },

    onDelete(event) {
        const that = this;
        const ds = event.currentTarget.dataset;
        const item = this.data.groups[ds.g].items[ds.i];
        haptics.strong();
        wx.showModal({
            title: '删除这条记录',
            content: '删除后不可恢复。',
            confirmText: '删除',
            confirmColor: '#e24b4a',
            success: function (res) {
                if (!res.confirm) {
                    that.setItemX(ds.g, ds.i, 0);
                    return;
                }
                store.remove(item.id).then(function (r) {
                    if (r.error) {
                        wx.showToast({ title: '删除失败，请重试', icon: 'none' });
                        return;
                    }
                    wx.showToast({ title: '已删除', icon: 'success' });
                    that.refresh();
                });
            },
        });
    },
});

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
