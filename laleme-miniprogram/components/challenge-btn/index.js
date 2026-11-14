// 转发给你在乎的人：首页与统计页共用
// 分享次数、称号与金色开关都在 utils/share.js，这里只负责展示与交互
const share = require('../../utils/share.js');
const haptics = require('../../utils/haptics.js');

const BADGE_TEXT = '已解锁「黄金大屎官」，让更多人闪闪发光';
const OFF_TEXT = '已切回普通身份 · 点一下换回金色';

Component({
    data: {
        count: 0,
        left: share.SHARE_BADGE_TARGET,
        badge: false,
        gold: false,
        progressText: '',
    },

    lifetimes: {
        attached() {
            this.sync();
        },
    },

    // 分享面板收起、页面回到前台时重新读一次进度
    pageLifetimes: {
        show() {
            this.sync();
        },
    },

    methods: {
        sync() {
            const count = share.shareCount();
            const left = Math.max(0, share.SHARE_BADGE_TARGET - count);
            const badge = share.shareBadge();
            const gold = share.shareGold();
            let text = '已转发 ' + count + ' 次 · 还差 ' + left + ' 次解锁黄金大屎官';
            if (badge) {
                text = gold ? BADGE_TEXT : OFF_TEXT;
            }
            this.setData({
                count: count,
                left: left,
                badge: badge,
                gold: gold,
                progressText: text,
            });
        },

        onTouch() {
            haptics.tap();
        },

        // 点击底部那行字，在普通 / 金色身份之间来回切
        onToggle() {
            if (!this.data.badge) {
                return;
            }
            haptics.tap();
            const gold = share.toggleGold();
            this.sync();
            // 通知宿主页面：首页的日历与主按钮要跟着一起换装
            this.triggerEvent('change', { gold: gold });
        },
    },
});
